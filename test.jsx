
// ===== NEW COLLECTIONS =====
const applicationsCollection = db.collection("hallApplications");
const seatsCollection = db.collection("hallSeats");
const settingsCollection = db.collection("appSettings");
 
// ============================================================
// APPLICATION WINDOW SETTINGS
// ============================================================
 
// Public: anyone (student app) can check if applications are open
app.get("/api/application-settings", async (req, res) => {
  try {
    const settings = await settingsCollection.findOne({ key: "hallApplication" });
    if (!settings) {
      return res.json({
        isOpen: false,
        startDate: null,
        endDate: null,
        fee: 0,
        mode: "auto",
      });
    }
    const now = new Date();
    let isOpen;
    if (settings.mode === "manual") {
      isOpen = !!settings.manualOpen;
    } else {
      isOpen =
        !!(settings.startDate && settings.endDate) &&
        now >= new Date(settings.startDate) &&
        now <= new Date(settings.endDate);
    }
    res.json({ ...settings, isOpen });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
 
// Admin: configure the window
// body: { startDate, endDate, fee, mode: "auto" | "manual", manualOpen: bool }
app.put("/api/admin/application-settings", async (req, res) => {
  try {
    const { startDate, endDate, fee, mode, manualOpen } = req.body;
    await settingsCollection.updateOne(
      { key: "hallApplication" },
      {
        $set: {
          key: "hallApplication",
          startDate: startDate || null,
          endDate: endDate || null,
          fee: Number(fee) || 0,
          mode: mode === "manual" ? "manual" : "auto",
          manualOpen: !!manualOpen,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    res.json({ message: "Settings updated" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
 
// ============================================================
// SEAT INVENTORY (so admin can only allocate a seat that's vacant)
// ============================================================
 
app.get("/api/admin/seats", async (req, res) => {
  try {
    const { status } = req.query; // "vacant" | "occupied"
    const filter = status ? { status } : {};
    const seats = await seatsCollection
      .find(filter)
      .sort({ hallName: 1, roomNumber: 1, seatNumber: 1 })
      .toArray();
    res.json(seats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
 
app.post("/api/admin/seats", async (req, res) => {
  try {
    const { hallName, roomNumber, seatNumber } = req.body;
    if (!hallName || !roomNumber || !seatNumber) {
      return res
        .status(400)
        .json({ message: "hallName, roomNumber, seatNumber are required" });
    }
    const existing = await seatsCollection.findOne({ hallName, roomNumber, seatNumber });
    if (existing) return res.status(400).json({ message: "That seat already exists" });
 
    const seat = {
      hallName,
      roomNumber,
      seatNumber,
      status: "vacant",
      occupiedBy: null,
      createdAt: new Date(),
    };
    const result = await seatsCollection.insertOne(seat);
    res.status(201).json({ message: "Seat added", seatId: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
 
app.delete("/api/admin/seats/:id", async (req, res) => {
  try {
    const seat = await seatsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (seat?.status === "occupied") {
      return res.status(400).json({ message: "Cannot remove an occupied seat" });
    }
    await seatsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: "Seat removed" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
 
// ============================================================
// STUDENT: SUBMIT / VIEW APPLICATION
// ============================================================
 
// Get the current user's latest application (or null)
app.get("/api/applications/me/:email", async (req, res) => {
  try {
    const application = await applicationsCollection.findOne(
      { studentEmail: req.params.email },
      { sort: { createdAt: -1 } }
    );
    res.json(application || null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
 
// Submit a new application (only while window is open, only one active at a time)
app.post("/api/applications", async (req, res) => {
  try {
    const settings = await settingsCollection.findOne({ key: "hallApplication" });
    const now = new Date();
    let isOpen = false;
    if (settings) {
      isOpen =
        settings.mode === "manual"
          ? !!settings.manualOpen
          : !!(settings.startDate && settings.endDate) &&
            now >= new Date(settings.startDate) &&
            now <= new Date(settings.endDate);
    }
    if (!isOpen) {
      return res.status(400).json({ message: "Hall applications are currently closed" });
    }
 
    const { studentEmail } = req.body;
    if (!studentEmail) {
      return res.status(400).json({ message: "studentEmail is required" });
    }
 
    const existing = await applicationsCollection.findOne({
      studentEmail,
      status: { $in: ["pending", "approved"] },
    });
    if (existing) {
      return res.status(400).json({ message: "You already have an active application" });
    }
 
    const application = {
      ...req.body,
      status: "pending",
      paymentStatus: "unpaid",
      fee: settings?.fee || 0,
      createdAt: new Date(),
    };
    const result = await applicationsCollection.insertOne(application);
    res.status(201).json({
      message: "Application submitted",
      applicationId: result.insertedId,
      fee: application.fee,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
 
// ============================================================
// ADMIN: REVIEW APPLICATIONS
// ============================================================
 
app.get("/api/admin/applications", async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const apps = await applicationsCollection.find(filter).sort({ createdAt: -1 }).toArray();
    res.json(apps);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
 
// Approve — allocates a specific vacant seat (subject to availability)
// body: { seatId }
app.put("/api/admin/applications/:id/approve", async (req, res) => {
  try {
    const { seatId } = req.body;
    if (!seatId) return res.status(400).json({ message: "seatId is required" });
 
    const application = await applicationsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!application) return res.status(404).json({ message: "Application not found" });
 
    if (application.paymentStatus !== "paid") {
      return res.status(400).json({ message: "Application fee has not been paid yet" });
    }
 
    const seat = await seatsCollection.findOne({ _id: new ObjectId(seatId), status: "vacant" });
    if (!seat) return res.status(400).json({ message: "That seat is no longer available" });
 
    await seatsCollection.updateOne(
      { _id: seat._id },
      { $set: { status: "occupied", occupiedBy: application.studentEmail } }
    );
 
    await applicationsCollection.updateOne(
      { _id: application._id },
      {
        $set: {
          status: "approved",
          hallName: seat.hallName,
          roomNumber: seat.roomNumber,
          seatNumber: seat.seatNumber,
          reviewedAt: new Date(),
        },
      }
    );
 
    // Keep the students collection (used by profile/room views) in sync
    await studentsCollection.updateOne(
      { email: application.studentEmail },
      {
        $set: {
          name: application.studentName,
          email: application.studentEmail,
          studentId: application.studentId,
          department: application.department,
          session: application.session,
          phone: application.phone,
          hallName: seat.hallName,
          roomNumber: seat.roomNumber,
          seatNumber: seat.seatNumber,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
 
    res.json({ message: "Application approved and seat allocated" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
 
app.put("/api/admin/applications/:id/reject", async (req, res) => {
  try {
    const { reason } = req.body;
    await applicationsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: "rejected", rejectionReason: reason || "", reviewedAt: new Date() } }
    );
    res.json({ message: "Application rejected" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
 
// ============================================================
// STRIPE CHECKOUT (application fee payment)
// ============================================================
 
// Creates a Stripe Checkout Session and returns its URL.
// The mobile app opens this URL in an in-app browser (expo-web-browser).
// body: { applicationId, amount, studentEmail }
app.post("/api/payments/create-checkout-session", async (req, res) => {
  try {
    const { applicationId, amount, studentEmail, successUrl, cancelUrl } = req.body;
    if (!applicationId || !amount) {
      return res.status(400).json({ message: "applicationId and amount are required" });
    }
 
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: studentEmail,
      line_items: [
        {
          price_data: {
            currency: "bdt",
            product_data: { name: "Hall Seat Application Fee" },
            unit_amount: Math.round(Number(amount) * 100),
          },
          quantity: 1,
        },
      ],
      metadata: { applicationId },
      // The app passes its own deep link (via expo-linking) so the
      // in-app browser can detect the redirect and close itself.
      success_url: successUrl || process.env.CLIENT_SUCCESS_SCHEME || "https://example.com/success",
      cancel_url: cancelUrl || process.env.CLIENT_CANCEL_SCHEME || "https://example.com/cancel",
    });
 
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
 
// Fallback/manual check in case the webhook hasn't landed yet by the time
// the app returns from the browser (Stripe usually fires it within seconds).
app.get("/api/payments/session-status/:sessionId", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    res.json({ status: session.payment_status }); // "paid" | "unpaid"
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
 
