// Load required modules
require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const winston = require('winston');

// Create Express app
const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Get your Render URL
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://charannapos.onrender.com';

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Configure CORS
const allowedOrigins = process.env.CORS_ORIGINS 
  ? process.env.CORS_ORIGINS.split(',') 
  : [RENDER_URL, 'https://charannapos.onrender.com', 'http://localhost:8080', 'http://localhost:5500'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Error handling for CORS
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    res.status(403).json({ error: 'CORS policy violation' });
  } else {
    next(err);
  }
});

// Middleware to parse JSON and URL-encoded data
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Rate limiting for payment endpoints
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: {
    error: 'Too many payment attempts, please try again later.',
    success: false
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to payment endpoints
app.use('/create-payment-intent', paymentLimiter);
app.use('/confirm-payment', paymentLimiter);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// All countries supported by Stripe
const ALL_COUNTRIES = [
  'US', 'CA', 'GB', 'AU', 'DE', 'FR', 'JP' // Simplified list for demo
];

// Route for the root path - serve HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Stripe configuration endpoint
app.get('/stripe-config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
  });
});

// Get countries list
app.get('/api/countries', (req, res) => {
  res.json({
    success: true,
    countries: ALL_COUNTRIES,
    count: ALL_COUNTRIES.length
  });
});

// Create payment intent endpoint
app.post('/create-payment-intent', async (req, res) => {
  try {
    logger.info('Received payment request', { 
      endpoint: '/create-payment-intent',
      fields: Object.keys(req.body)
    });
    
    // Extract fields
    const {
      amount = 57.48,
      currency = 'usd'
    } = req.body;

    logger.info('Extracted payment values', {
      amount, currency
    });

    // Validate required fields
    if (!amount) {
      logger.warn('Missing required field: amount');
      return res.status(400).json({
        error: 'Amount is required',
        success: false,
        missingFields: ['amount']
      });
    }

    // Convert amount to cents
    const amountInCents = Math.round(parseFloat(amount) * 100);
    
    if (isNaN(amountInCents) || amountInCents <= 0) {
      logger.warn('Invalid amount provided', { amount, amountInCents });
      return res.status(400).json({
        error: 'Invalid amount. Please enter a valid number.',
        success: false
      });
    }

    // Create payment intent with automatic payment methods
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency.toLowerCase(),
      automatic_payment_methods: {
        enabled: true,
      }
    });

    logger.info('Payment intent created successfully', { 
      paymentIntentId: paymentIntent.id,
      amount: amountInCents,
      currency: currency || 'usd',
      status: paymentIntent.status
    });
    
    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      message: 'Payment intent created successfully'
    });
    
  } catch (error) {
    logger.error('Payment processing error', { 
      error: error.message,
      stack: error.stack
    });
    
    res.status(400).json({
      error: error.message,
      success: false,
      details: 'Payment processing failed'
    });
  }
});

// Complete payment in one step (create payment method and confirm payment intent)
app.post('/confirm-payment', async (req, res) => {
  try {
    const { 
      paymentIntentId, 
      cardNumber, 
      expiry, 
      cvc, 
      name,
      email,
      street,
      city,
      state,
      zip,
      country
    } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({
        error: 'Payment intent ID is required',
        success: false
      });
    }

    // Parse expiry date (format: MM/YY)
    const [expMonth, expYearPartial] = expiry.split('/');
    const expYear = parseInt(expYearPartial) + 2000; // Convert YY to YYYY

    // Clean card number
    const cleanCardNumber = cardNumber.replace(/\s/g, '');

    // Create payment method
    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        number: cleanCardNumber,
        exp_month: parseInt(expMonth),
        exp_year: expYear,
        cvc: cvc
      },
      billing_details: {
        name: name,
        email: email,
        address: {
          line1: street,
          city: city,
          state: state,
          postal_code: zip,
          country: country
        }
      }
    });

    // Confirm the payment intent with the payment method
    const paymentIntent = await stripe.paymentIntents.confirm(
      paymentIntentId,
      { 
        payment_method: paymentMethod.id,
        return_url: `${req.headers.origin}/success` // For redirect-based flows
      }
    );
    
    logger.info('Payment confirmation status', {
      paymentIntentId,
      status: paymentIntent.status
    });

    // Check the payment intent status
    if (paymentIntent.status === 'succeeded') {
      res.json({
        success: true,
        status: 'succeeded',
        message: 'Payment completed successfully',
        paymentIntent
      });
    } else if (paymentIntent.status === 'requires_action') {
      // Handle 3D Secure authentication
      res.json({
        success: true,
        status: 'requires_action',
        message: 'Additional authentication required',
        next_action: paymentIntent.next_action,
        clientSecret: paymentIntent.client_secret
      });
    } else if (paymentIntent.status === 'requires_payment_method') {
      // Handle failed payment
      res.status(400).json({
        success: false,
        status: 'requires_payment_method',
        error: 'Payment failed. Please try a different payment method.',
        paymentIntent
      });
    } else {
      // Handle other statuses
      res.json({
        success: true,
        status: paymentIntent.status,
        message: 'Payment processing',
        paymentIntent
      });
    }
    
  } catch (error) {
    logger.error('Payment confirmation error', {
      error: error.message,
      paymentIntentId: req.body.paymentIntentId
    });
    
    res.status(400).json({
      error: error.message,
      success: false,
      details: 'Payment confirmation failed'
    });
  }
});

// Test endpoint to check form data
app.post('/test-form', (req, res) => {
  logger.info('Form submission test', {
    body: req.body,
    contentType: req.get('Content-Type')
  });
  
  res.json({
    success: true,
    message: 'Form data received successfully',
    receivedData: req.body
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  const stripeConfigured = !!process.env.STRIPE_SECRET_KEY;
  
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'SecurePay Payment Server',
    environment: process.env.NODE_ENV || 'production',
    stripe: {
      configured: stripeConfigured,
      mode: stripeConfigured ? (process.env.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test') : 'not_configured'
    }
  });
});

// Success page
app.get('/success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Successful</title>
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
          text-align: center; 
          padding: 50px; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 12px;
          color: #333;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        .success { 
          color: #4CAF50; 
          font-size: 24px; 
          font-weight: bold;
          margin-bottom: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success">✅ Payment Successful!</div>
        <p>Your payment has been processed successfully.</p>
        <p>You can close this window and return to the application.</p>
      </div>
    </body>
    </html>
  `);
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((error, req, res, next) => {
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method
  });
  
  res.status(500).json({
    error: 'Internal server error',
    success: false,
    details: isProduction? undefined: error.message
  });
});

// Start server
app.listen(port, () => {
  logger.info('Server started', {
    port,
    environment: process.env.NODE_ENV || 'production'
  });
  
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`💳 Stripe mode: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'LIVE' : 'TEST'}`);
  console.log(`✅ Health check: http://localhost:${port}/health`);
});
