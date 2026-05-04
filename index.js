const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
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
  const db = client.db("hallApps");

  const usersCollection = db.collection("users");
const complaintsCollection = db.collection("complaints");
const noticesCollection = db.collection("notices");
const paymentsCollection = db.collection("payments");
const menusCollection = db.collection("menus");

//   // GET all items
//   app.get("/items", async (req, res) => {
//     try {
//       const items = await itemsCollection.find().toArray();
//       res.send(items);
//     } catch (error) {
//       res.status(500).send({ error: "Server error" });
//     }
//   });








//start of the index.js
  console.log("MongoDB Ready");
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
