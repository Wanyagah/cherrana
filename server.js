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
  : [RENDER_URL, 'https://charannapos.onrender.com', 'http://localhost:8080', 'http://localhost:5500', 'http://localhost:3000'];

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
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    success: true
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
      body: req.body
    });
    
    // Extract fields
    const {
      amount = 57.48,
      currency = 'usd',
      description = 'SecurePay Payment'
    } = req.body;

    // Validate required fields
    if (!amount) {
      return res.status(400).json({
        error: 'Amount is required',
        success: false,
        missingFields: ['amount']
      });
    }

    // Convert amount to cents
    const amountInCents = Math.round(parseFloat(amount) * 100);
    
    if (isNaN(amountInCents) || amountInCents < 50) { // Minimum amount check
      return res.status(400).json({
        error: 'Invalid amount. Minimum payment is $0.50.',
        success: false
      });
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency.toLowerCase(),
      description: description,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        created_via: 'securepay_api'
      }
    });

    logger.info('Payment intent created successfully', { 
      paymentIntentId: paymentIntent.id,
      amount: amountInCents,
      currency: currency,
      status: paymentIntent.status
    });
    
    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: amountInCents,
      currency: currency,
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

// Confirm payment with payment method ID (from Stripe Elements)
app.post('/confirm-payment', async (req, res) => {
  try {
    const { 
      paymentIntentId, 
      paymentMethodId,
      billingDetails
    } = req.body;

    if (!paymentIntentId || !paymentMethodId) {
      return res.status(400).json({
        error: 'Payment intent ID and payment method ID are required',
        success: false
      });
    }

    // Confirm the payment intent with the payment method
    const paymentIntent = await stripe.paymentIntents.confirm(
      paymentIntentId,
      { 
        payment_method: paymentMethodId,
        return_url: `${req.headers.origin}/success`
      }
    );
    
    logger.info('Payment confirmation status', {
      paymentIntentId,
      status: paymentIntent.status,
      requiresAction: paymentIntent.status === 'requires_action'
    });

    // Return appropriate response based on status
    const response = {
      success: true,
      status: paymentIntent.status,
      paymentIntentId: paymentIntent.id,
      requiresAction: paymentIntent.status === 'requires_action',
      clientSecret: paymentIntent.client_secret
    };

    if (paymentIntent.status === 'requires_action') {
      response.message = 'Additional authentication required';
      response.nextAction = paymentIntent.next_action;
    } else if (paymentIntent.status === 'succeeded') {
      response.message = 'Payment completed successfully';
    } else if (paymentIntent.status === 'processing') {
      response.message = 'Payment is processing';
    } else if (paymentIntent.status === 'requires_payment_method') {
      response.success = false;
      response.message = 'Payment failed. Please try a different payment method.';
    }

    res.json(response);
    
  } catch (error) {
    logger.error('Payment confirmation error', {
      error: error.message,
      paymentIntentId: req.body.paymentIntentId
    });
    
    // Handle specific Stripe errors
    let errorMessage = 'Payment confirmation failed';
    if (error.type === 'StripeCardError') {
      errorMessage = error.message;
    } else if (error.code === 'payment_intent_authentication_failure') {
      errorMessage = 'Authentication failed. Please try again.';
    }
    
    res.status(400).json({
      error: errorMessage,
      success: false,
      details: error.message,
      code: error.code || 'unknown_error'
    });
  }
});

// Retrieve payment intent status
app.get('/payment-intent/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const paymentIntent = await stripe.paymentIntents.retrieve(id);
    
    res.json({
      success: true,
      status: paymentIntent.status,
      paymentIntent: {
        id: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
        created: paymentIntent.created,
        charges: paymentIntent.charges
      }
    });
  } catch (error) {
    res.status(400).json({
      error: error.message,
      success: false
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
    },
    endpoints: {
      createPaymentIntent: 'POST /create-payment-intent',
      confirmPayment: 'POST /confirm-payment',
      getConfig: 'GET /stripe-config'
    }
  });
});

// Success page
app.get('/success', (req, res) => {
  const { payment_intent, payment_intent_client_secret } = req.query;
  
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
          max-width: 500px;
        }
        .success { 
          color: #4CAF50; 
          font-size: 24px; 
          font-weight: bold;
          margin-bottom: 20px;
        }
        .button {
          background: #4a6cf7;
          color: white;
          padding: 12px 24px;
          border-radius: 8px;
          text-decoration: none;
          display: inline-block;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success">✅ Payment Successful!</div>
        <p>Your payment has been processed successfully.</p>
        <p>Payment Intent: ${payment_intent || 'N/A'}</p>
        <a href="/" class="button">Return to Payment</a>
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
    details: isProduction ? undefined : error.message
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
  console.log(`🔗 Allowed origins: ${allowedOrigins.join(', ')}`);
});
