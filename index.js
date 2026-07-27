const express = require('express');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from the bot folder, fallback to the parent folder
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const webhookRouter = require('./src/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming JSON request bodies
app.use(express.json());

// Mount webhook router
app.use('/webhook', webhookRouter);

// Health check endpoint
app.get('/', (req, res) => {
  try {
    res.json({ status: "Enlight Sales Bot running" });
  } catch (error) {
    console.error("Error in health check route:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

const { startScheduler } = require('./src/scheduler');

// Start server
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
  startScheduler();
});
