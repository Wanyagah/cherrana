// Load required modules
require('dotenv').config();
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

// ... rest of your server code remains the same, just remove sanitize-html references ...;

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

// Middleware to sanitize inputs
app.use((req, res, next) => {
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeHtml(req.body[key]);
      }
    });
  }
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

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// All countries supported by Stripe
const ALL_COUNTRIES = [
  'AC', 'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO',
  'CR', 'CV', 'CW', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER',
  'ES', 'ET', 'FI', 'FJ', 'FK', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL',
  'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HN', 'HR', 'HT', 'HU', 'ID',
  'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI',
  'KM', 'KN', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV',
  'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MK', 'ML', 'MM', 'MN', 'MO', 'MQ', 'MR', 'MS', 'MT',
  'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU',
  'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PY', 'QA',
  'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL',
  'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TA', 'TC', 'TD', 'TF', 'TG', 'TH',
  'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WF', 'WS', 'XK', 'YE', 'YT', 'ZA', 'ZM', 'ZW'
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
    
    // Extract fields based on your HTML structure
    const {
      name,
      email,
      street,
      city,
      state,
      zip,
      country,
      amount = 57.48, // Default amount from your frontend
      currency = 'usd',
      paymentMethodId,
      idempotencyKey
    } = req.body;

    logger.info('Extracted payment values', {
      name, email, street, city, state, zip, country, amount, currency
    });

    // Validate required fields
    const requiredFields = [
      { value: amount, name: 'amount', label: 'Amount' },
      { value: name, name: 'name', label: 'Full Name' },
      { value: email, name: 'email', label: 'Email' },
      { value: street, name: 'street', label: 'Street Address' },
      { value: city, name: 'city', label: 'City' },
      { value: state, name: 'state', label: 'State/Province' },
      { value: zip, name: 'zip', label: 'ZIP/Postal Code' },
      { value: country, name: 'country', label: 'Country' }
    ];

    const missingFields = requiredFields.filter(({ value }) => 
      value === undefined || value === null || value === ''
    );

    if (missingFields.length > 0) {
      logger.warn('Missing required fields', { missingFields });
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.map(f => f.label).join(', ')}`,
        success: false,
        missingFields: missingFields.map(f => f.name)
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

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency.toLowerCase(),
      payment_method_types: ['card'],
      metadata: {
        customer_name: name,
        customer_email: email,
        billing_street: street,
        billing_city: city,
        billing_state: state,
        billing_zip: zip,
        billing_country: country
      },
      shipping: {
        name: name,
        address: {
          line1: street,
          city: city,
          state: state,
          postal_code: zip,
          country: country
        }
      },
      receipt_email: email,
      description: `SecurePay Payment - ${name}`
    }, {
      idempotencyKey: idempotencyKey || `pi_${Date.now()}`
    });

    logger.info('Payment intent created successfully', { 
      paymentIntentId: paymentIntent.id,
      amount: amountInCents,
      currency: currency || 'usd'
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

// Confirm payment endpoint
app.post('/confirm-payment', async (req, res) => {
  try {
    const { 
      paymentIntentId, 
      cardNumber, 
      expiry, 
      cvc, 
      billing_address,
      pin 
    } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({
        error: 'Payment intent ID is required',
        success: false
      });
    }

    // Validate PIN if provided
    if (pin && !/^\d{4}$|^\d{6}$/.test(pin)) {
      return res.status(400).json({ 
        error: 'PIN must be 4 or 6 digits' 
      });
    }

    // Parse expiry
    const [expMonth, expYear] = expiry.split('/').map(part => 
      parseInt(part.trim()) + (part.length === 2 && parseInt(part) < 50 ? 2000 : 1900)
    );

    // Clean card number
    const cleanCardNumber = cardNumber.replace(/\s/g, '');

    // Create payment method
    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        number: cleanCardNumber,
        exp_month: expMonth,
        exp_year: expYear,
        cvc: cvc
      },
      billing_details: billing_address ? {
        name: billing_address.name,
        email: billing_address.email,
        address: {
          line1: billing_address.street,
          city: billing_address.city,
          state: billing_address.state,
          postal_code: billing_address.zip,
          country: billing_address.country
        }
      } : undefined
    });

    // Confirm the payment intent
    const paymentIntent = await stripe.paymentIntents.confirm(
      paymentIntentId,
      { payment_method: paymentMethod.id }
    );
    
    logger.info('Payment confirmation status', {
      paymentIntentId,
      status: paymentIntent.status
    });

    res.json({
      success: true,
      status: paymentIntent.status,
      paymentIntent
    });
    
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

// Webhook endpoint for Stripe events (for handling asynchronous payments)
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logger.error('Webhook signature verification failed', { error: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      logger.info('Payment succeeded via webhook', { paymentIntentId: paymentIntent.id });
      // Here you can update your database, send confirmation emails, etc.
      break;
    case 'payment_intent.payment_failed':
      const failedPaymentIntent = event.data.object;
      logger.error('Payment failed via webhook', { 
        paymentIntentId: failedPaymentIntent.id,
        error: failedPaymentIntent.last_payment_error
      });
      break;
    default:
      logger.info(`Unhandled event type: ${event.type}`);
  }

  res.json({received: true});
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
    receivedData: req.body,
    fieldDetails: 'Check that all form fields have name attributes matching the server expectations'
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
      mode: stripeConfigured? (process.env.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test') : 'not_configured'
    },
    features: {
      cvc_verification: true,
      billing_address: true,
      countries: ALL_COUNTRIES.length
    },
    expectedFieldNames: [
      'name', 'email', 'street', 'city', 'state', 'zip', 'country', 'amount', 'currency'
    ]
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
  console.log(`🧪 Test form: http://localhost:${port}/test-form`);
  console.log(`🔗 Render URL: ${RENDER_URL}`);
});
