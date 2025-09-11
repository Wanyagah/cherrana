// Load required modules
const express = require('express');
const stripe = require('stripe')('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');
const path = require('path');

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Route for the root path - serve HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Create payment intent endpoint
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency, name, email } = req.body;
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: currency || 'usd',
      metadata: {
        name: name,
        email: email
      }
    });
    res.json({
      clientSecret: paymentIntent.client_secret
    });
  } catch (error) {
    res.status(400).json({
      error: error.message
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
