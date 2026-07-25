const express = require("express");
const app = express();
require("dotenv").config();

const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET);

const cors = require("cors");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { MongoClient, ServerApiVersion,ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.zeenoci.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error(" MongoDB connection warning:", err.message);
    console.log(" Continuing without database...");
  }

  const db = client.db("hallApps");
  const usersCollection = db.collection("users");
  const studentsCollection = db.collection("students");
  const noticesCollection = db.collection("notices");
  const complaintsCollection = db.collection("complaints");
  const paymentsCollection = db.collection("payments");
  const canteenMenuCollection = db.collection("canteenMenu");
  const eventsCollection = db.collection("events");
  const applicationsCollection = db.collection("hallApplications");
  const seatsCollection = db.collection("hallSeats");
  const settingsCollection = db.collection("appSettings");

  // Signup - Pw-based auth
app.post("/api/auth/signup", async (req, res) => {
    try {
      const { fullName, email, phone, password, role } = req.body;
      // Validation
      if (!fullName || !email || !phone || !password) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      // Check if user already exists
      const existing = await usersCollection.findOne({ email });
      if (existing) {
        return res.status(400).json({ message: "Email already exists" });
      }
      // Generate UID (unique identifier for frontend)
      const uid = `user_${crypto.randomBytes(12).toString('hex')}`;
      const hashedPassword = await bcrypt.hash(password, 10);
      // Create new user
      const newUser = {
        uid,
        fullName,
        email,
        phone,
        password: hashedPassword,
        role: role || "student",
        profilePicture: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          lastLogin: null,
          loginCount: 0,
        },
      };

      const result = await usersCollection.insertOne(newUser);

      // Return user data (without pw)
      res.status(201).json({
        id: result.insertedId,
        fullName: newUser.fullName,
        email: newUser.email,
        phone: newUser.phone,
        uid: newUser.uid,
        role: newUser.role,
        createdAt: newUser.createdAt,
      });
    } catch (err) {
      console.error("Signup error:", err);
      res.status(500).json({ message: "Server error during signup" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      // Validation
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid password" });
      }

      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            "metadata.lastLogin": new Date(),
            updatedAt: new Date(),
          },
          $inc: { "metadata.loginCount": 1 },
        }
      );

      res.json({
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        uid: user.uid,
        role: user.role,
        createdAt: user.createdAt,
      });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ message: "Server error during login" });
    }
  });

  // Get user profile by UID
  app.get("/api/auth/profile/:uid", async (req, res) => {
    try {
      const user = await usersCollection.findOne({ uid: req.params.uid });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        uid: user.uid,
        role: user.role,
        profilePicture: user.profilePicture,
        createdAt: user.createdAt,
      });
    } catch (err) {
      console.error("Profile error:", err);
      res.status(500).json({ message: "Server error" });
    }
  });

  // ADMIN
  app.get("/api/admin/students", async (req, res) => {
    try {
      const students = await studentsCollection.find().toArray();
      res.json(students);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/students", async (req, res) => {
    try {
      const student = {
        ...req.body,
        createdAt: new Date(),
      };
      const result = await studentsCollection.insertOne(student);
      res.status(201).json({ message: "Student added", studentId: result.insertedId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/admin/students/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const updated = await studentsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: req.body }
      );
      res.json({ message: "Student updated", result: updated });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/admin/students/:id", async (req, res) => {
  try {
    const student = await studentsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!student) return res.status(404).json({ message: "Student not found" });
    res.json(student);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

  app.delete("/api/admin/students/:id", async (req, res) => {
    try {
      const id = req.params.id;
      await studentsCollection.deleteOne({ _id: new ObjectId(id) });
      res.json({ message: "Student deleted" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/admin/allocate-room/:studentId", async (req, res) => {
    try {
      const { roomNumber, seatNumber, hallName } = req.body;
      const result = await studentsCollection.updateOne(
        { _id: new ObjectId(req.params.studentId) },
        { $set: { roomNumber, seatNumber, hallName } }
      );
      res.json({ message: "Room allocated", result });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await usersCollection.find(
      {},
      { projection: { password: 0 } } // password বাদ দাও
    ).toArray();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put("/api/admin/users/:id/role", async (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ["student", "admin", "accountant", "canteen_manager", "hall_rep"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    await usersCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { role, updatedAt: new Date() } }
    );
    res.json({ message: "Role updated successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/admin/users/:id", async (req, res) => {
  try {
    await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

  // NOTICE ROUTES
  app.get("/api/notices", async (req, res) => {
    try {
      const notices = await noticesCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.json(notices);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/notices", async (req, res) => {
    try {
      const notice = {
        ...req.body,
        createdAt: new Date(),
      };
      const result = await noticesCollection.insertOne(notice);
      res.status(201).json({ message: "Notice published", noticeId: result.insertedId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/admin/notices/:id", async (req, res) => {
    try {
      const { title, content } = req.body;
      if (!title || !content) {
        return res.status(400).json({ message: "Title and content are required" });
      }
      const result = await noticesCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { title, content, updatedAt: new Date() } }
      );
      if (result.matchedCount === 0) {
        return res.status(404).json({ message: "Notice not found" });
      }
      res.json({ message: "Notice updated" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/admin/notices/:id", async (req, res) => {
    try {
      await noticesCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.json({ message: "Notice deleted" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // COMPLAINT ROUTES
  app.post("/api/complaints", async (req, res) => {
    try {
      const complaint = {
        ...req.body,
        status: "pending",
        createdAt: new Date(),
      };
      const result = await complaintsCollection.insertOne(complaint);
      res.status(201).json({ message: "Complaint submitted", complaintId: result.insertedId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/complaints", async (req, res) => {
    try {
      const complaints = await complaintsCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.json(complaints);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/complaints/student/:studentEmail", async (req, res) => {
    try {
      const complaints = await complaintsCollection
        .find({ studentEmail: req.params.studentEmail })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(complaints);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/complaints/:id", async (req, res) => {
    try {
      const result = await complaintsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { ...req.body, updatedAt: new Date() } }
      );
      res.json({ message: "Complaint updated", result });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // CANTEEN MENU ROUTES
  app.get("/api/canteen/menu/today", async (req, res) => {
    try {
      const today = new Date().toISOString().split("T")[0]; // "2024-12-01"
      const menu = await canteenMenuCollection.findOne({ date: today });
      res.json(menu || { message: "No menu posted for today" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });
  app.get("/api/canteen/menu", async (req, res) => {
    try {
      const menus = await canteenMenuCollection
        .find()
        .sort({ date: -1 })
        .toArray();
      res.json(menus);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/canteen/menu", async (req, res) => {
    try {
      const existing = await canteenMenuCollection.findOne({ date: req.body.date });
      if (existing) {
        await canteenMenuCollection.updateOne(
          { date: req.body.date },
          { $set: { ...req.body, updatedAt: new Date() } }
        );
        return res.json({ message: "Menu updated for " + req.body.date });
      }

      const menu = { ...req.body, createdAt: new Date() };
      const result = await canteenMenuCollection.insertOne(menu);
      res.status(201).json({ message: "Menu posted", menuId: result.insertedId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });
  
  app.post("/api/canteen/feedback", async (req, res) => {
    try {
      const feedbackCollection = db.collection("canteenFeedback");
      const feedback = { ...req.body, createdAt: new Date() };
      await feedbackCollection.insertOne(feedback);
      res.status(201).json({ message: "Feedback submitted" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/canteen/feedback", async (req, res) => {
    try {
      const feedbackCollection = db.collection("canteenFeedback");
      const feedbacks = await feedbackCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.json(feedbacks);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

app.delete("/api/canteen/menu/:id", async (req, res) => {
  try {
    await canteenMenuCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: "Menu deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/canteen/menu/date/:date", async (req, res) => {
  try {
    const menu = await canteenMenuCollection.findOne({ date: req.params.date });
    res.json(menu || { message: "No menu for this date" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

  // HALL REP ROUTES
  app.get("/api/events", async (req, res) => {
    try {
      const events = await eventsCollection
        .find()
        .sort({ date: -1 })
        .toArray();
      res.json(events);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/events", async (req, res) => {
    try {
      const event = { ...req.body, createdAt: new Date() };
      const result = await eventsCollection.insertOne(event);
      res.status(201).json({ message: "Event created", eventId: result.insertedId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/events/:id", async (req, res) => {
    try {
      await eventsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { ...req.body, updatedAt: new Date() } }
      );
      res.json({ message: "Event updated" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/events/:id", async (req, res) => {
    try {
      await eventsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.json({ message: "Event deleted" });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

app.patch("/api/events/:id/activity", async (req, res) => {
  try {
    await eventsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { activityUpdate: req.body.activityUpdate, updatedAt: new Date() } }
    );
    res.json({ message: "Activity updated" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


  app.get("/api/student/profile/:email", async (req, res) => {
  try {
    let student = await studentsCollection.findOne({ email: req.params.email });

    if (!student) {
      const user = await usersCollection.findOne({ email: req.params.email });
      if (!user) return res.status(404).json({ message: "Student not found" });

      return res.json({
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        studentId: null,
        department: null,
        session: null,
        hallName: null,
        roomNumber: null,
        seatNumber: null,
        _fromUsers: true,
      });
    }

    res.json(student);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// Firebase login then role fetch
app.get("/api/auth/me", async (req, res) => {
  try {
    const { email } = req.query;
    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      subRole: user.subRole,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// APPLICATION WINDOW SETTINGS
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
 
// SEAT INVENTORY (so admin can only allocate a seat that's vacant)
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
 
// STUDENT: SUBMIT / VIEW APPLICATION
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
 
//Submit a new application(only while window is open,only one active at a time,& only if the student doesn't already have a hall seat)
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

    // 🚫 Already has a seat? Block re-application.
    const existingSeat = await studentsCollection.findOne({
      email: studentEmail,
      roomNumber: { $exists: true, $ne: null, $ne: "" },
    });
    if (existingSeat) {
      return res.status(400).json({
        message: "You already have a hall seat allocated. You cannot apply again.",
      });
    }

    // 🚫 Already has a pending/approved application? Block duplicate.
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

    // Mirror this as an "unpaid" record in the payments collection too,
    // so it shows up in the existing Payment/Due-List screens.
    await paymentsCollection.insertOne({
      applicationId: result.insertedId,
      studentId: req.body.studentId || null,
      studentName: req.body.studentName || null,
      email: studentEmail,
      uid: req.body.uid || null,
      amount: settings?.fee || 0,
      scholarshipAmount: 0,
      semester: "Hall Application Fee",
      status: "unpaid",
      source: "hall_application",
      createdAt: new Date(),
    });

    res.status(201).json({
      message: "Application submitted",
      applicationId: result.insertedId,
      fee: application.fee,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

//REVIEW APPLICATIONS
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
 
// Approve — allocates a specific vacant seat
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
 
// STRIPE CHECKOUT (application fee payment)
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
      success_url: successUrl || process.env.CLIENT_SUCCESS_SCHEME || "https://example.com/success",
      cancel_url: cancelUrl || process.env.CLIENT_CANCEL_SCHEME || "https://example.com/cancel",
    });
 
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
 
// Generic checkout — works for ANY payment record (accountant-added, hall-application-mirrored, etc.)
app.post("/api/payments/:id/create-checkout-session", async (req, res) => {
  try {
    const payment = await paymentsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!payment) return res.status(404).json({ message: "Payment record not found" });
    if (payment.status === "paid") {
      return res.status(400).json({ message: "This payment is already paid" });
    }

    const net = (Number(payment.amount) || 0) - (Number(payment.scholarshipAmount) || 0);
    if (net <= 0) {
      return res.status(400).json({ message: "Nothing due for this payment" });
    }

    const { successUrl, cancelUrl } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: payment.email,
      line_items: [
        {
          price_data: {
            currency: "bdt",
            product_data: { name: payment.semester || "Payment" },
            unit_amount: Math.round(net * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        paymentId: String(payment._id),
        applicationId: payment.applicationId ? String(payment.applicationId) : "",
      },
      success_url: successUrl || process.env.CLIENT_SUCCESS_SCHEME || "https://example.com/success",
      cancel_url: cancelUrl || process.env.CLIENT_CANCEL_SCHEME || "https://example.com/cancel",
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/payments/session-status/:sessionId", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    const status = session.payment_status; // "paid" | "unpaid"

    if (status === "paid") {
      const { applicationId, paymentId } = session.metadata || {};

      // Case 1: paid from a specific payment record (Payment Status page / accountant-added dues)
      if (paymentId) {
        await paymentsCollection.updateOne(
          { _id: new ObjectId(paymentId) },
          { $set: { status: "paid", paidAt: new Date(), stripeSessionId: session.id } }
        );
      }

      // Case 2: linked to a hall application — keep application + payment record in sync either way
      if (applicationId) {
        await applicationsCollection.updateOne(
          { _id: new ObjectId(applicationId) },
          { $set: { paymentStatus: "paid", paidAt: new Date(), stripeSessionId: session.id } }
        );
        // Fallback for the older "Apply for Hall Seat" flow, which only sends applicationId
        if (!paymentId) {
          await paymentsCollection.updateOne(
            { applicationId: new ObjectId(applicationId) },
            { $set: { status: "paid", paidAt: new Date(), stripeSessionId: session.id } }
          );
        }
      }
    }

    res.json({ status });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


app.get("/api/payments", async (req, res) => {
    try {
      const { search, semester, status } = req.query;
      let filter = {};
      if (status) filter.status = status;
      if (semester) filter.semester = semester;
      if (search) {
        filter.$or = [
          { studentName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ];
      }
      const payments = await paymentsCollection.find(filter).sort({ createdAt: -1 }).toArray();
      res.json(payments);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // Due list
  app.get("/api/payments/due", async (req, res) => {
    try {
      const dueList = await paymentsCollection
        .find({ status: "unpaid" })
        .toArray();
      res.json(dueList);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });


  app.get("/api/payments/summary", async (req, res) => {
    try {
      const all = await paymentsCollection.find().toArray();
      const now = new Date();
      const thisMonth = now.getMonth();
      const thisYear = now.getFullYear();

      let totalCollected = 0, totalDue = 0, monthlyCollection = 0, pendingCount = 0;

      all.forEach(p => {
        const net = (Number(p.amount) || 0) - (Number(p.scholarshipAmount) || 0);
        if (p.status === "paid") {
          totalCollected += net;
          const paidDate = p.paidAt ? new Date(p.paidAt) : null;
          if (paidDate && paidDate.getMonth() === thisMonth && paidDate.getFullYear() === thisYear) {
            monthlyCollection += net;
          }
        } else {
          totalDue += net;
          pendingCount += 1;
        }
      });

      res.json({ totalCollected, totalDue, monthlyCollection, pendingCount });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/payments/student/:studentId", async (req, res) => {
  try {
    const id = req.params.studentId;
    const payments = await paymentsCollection
      .find({
        $or: [
          { studentId: id },
          { email: id },
          { uid: id },
        ]
      })
      .toArray();
    res.json(payments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
  });
  // Accountant payment add
  app.post("/api/payments", async (req, res) => {
    try {
      const payment = {
        ...req.body,
        createdAt: new Date(),
      };
      const result = await paymentsCollection.insertOne(payment);
      res.status(201).json({ message: "Payment recorded", paymentId: result.insertedId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });
  // Accountant payment update (paid/unpaid/scholarship)
  app.put("/api/payments/:id", async (req, res) => {
    try {
      const result = await paymentsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { ...req.body, updatedAt: new Date() } }
      );
      res.json({ message: "Payment updated", result });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });
 
  app.get("/api/payments/report", async (req, res) => {
    try {
      const { month, year, semester } = req.query;
      const all = await paymentsCollection.find().toArray();

      let filtered = all;
      if (month && year) {
        filtered = filtered.filter(p => {
          const d = p.paidAt ? new Date(p.paidAt) : new Date(p.createdAt);
          return d.getMonth() + 1 === Number(month) && d.getFullYear() === Number(year);
        });
      }
      if (semester) {
        filtered = filtered.filter(p => p.semester === semester);
      }

      const paid = filtered.filter(p => p.status === "paid");
      const unpaid = filtered.filter(p => p.status !== "paid");

      const totalCollected = paid.reduce((s, p) => s + ((Number(p.amount) || 0) - (Number(p.scholarshipAmount) || 0)), 0);
      const totalDue = unpaid.reduce((s, p) => s + ((Number(p.amount) || 0) - (Number(p.scholarshipAmount) || 0)), 0);

      res.json({
        totalRecords: filtered.length,
        paidCount: paid.length,
        unpaidCount: unpaid.length,
        totalCollected,
        totalDue,
        records: filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });


  app.get("/api/payments/:id", async (req, res) => {
    try {
      const payment = await paymentsCollection.findOne({ _id: new ObjectId(req.params.id) });
      if (!payment) return res.status(404).json({ message: "Payment not found" });
      res.json(payment);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });


  console.log("✅ Routes configured");
}



app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  // console.log(`📡 API URL: http://localhost:${port}`);
  // console.log(`📝 Base URL: http://localhost:${port}/api`);
});

run().catch(err => {
  console.error("❌ Database initialization error:", err);
});
