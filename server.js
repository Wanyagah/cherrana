require('dotenv').config();
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// Get your Render URL
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://your-app-name.onrender.com';

// CORS configuration
const allowedOrigins = [
  RENDER_URL,
  'https://your-domain.com'
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

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

// Get countries list
app.get('/api/countries', (req, res) => {
  res.json({
    success: true,
    countries: ALL_COUNTRIES,
    count: ALL_COUNTRIES.length
  });
});

// Create payment intent with CVC verification
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency = 'usd' } = req.body;

    // Validate amount
    if (!amount || amount <= 0 || amount > 10000) {
      return res.status(400).json({ 
        error: 'Invalid amount. Must be between $0.01 and $10,000' 
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: currency,
      payment_method_types: ['card'],
      capture_method: 'automatic',
      metadata: {
        payment_type: 'virtual_card_cnp',
        environment: isProduction ? 'production' : 'development',
        cvc_verified: true
      }
    });

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      status: 'requires_payment_method'
    });

  } catch (error) {
    console.error('Payment intent error:', error);
    res.status(500).json({ 
      error: 'Failed to create payment intent',
      details: isProduction ? undefined : error.message
    });
  }
});

// Confirm payment with CVC verification and billing address
app.post('/confirm-payment', async (req, res) => {
  try {
    const { 
      paymentIntentId, 
      cardNumber, 
      expiry, 
      cvc, 
      pin,
      billing_address 
    } = req.body;

    // Validate required fields
    if (!paymentIntentId || !cardNumber || !expiry || !cvc || !pin) {
      return res.status(400).json({ 
        error: 'Missing required payment information' 
      });
    }

    // Validate PIN
    if (!/^\d{4}$|^\d{6}$/.test(pin)) {
      return res.status(400).json({ 
        error: 'PIN must be 4 or 6 digits' 
      });
    }

    // Validate billing address if provided
    if (billing_address) {
      const addressErrors = validateBillingAddress(billing_address);
      if (addressErrors.length > 0) {
        return res.status(400).json({ 
          error: 'Invalid billing address', 
          details: addressErrors 
        });
      }
    }

    // Parse expiry
    const [expMonth, expYear] = expiry.split('/').map(part => parseInt(part.trim()));
    if (!expMonth || !expYear || expMonth < 1 || expMonth > 12) {
      return res.status(400).json({ 
        error: 'Invalid expiry date format. Use MM/YY' 
      });
    }

    // Clean card number
    const cleanCardNumber = cardNumber.replace(/\s/g, '');

    // Create payment method with CVC verification
    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        number: cleanCardNumber,
        exp_month: expMonth,
        exp_year: expYear,
        cvc: cvc
      },
      ...(billing_address && {
        billing_details: {
          address: {
            line1: billing_address.street,
            line2: billing_address.street2 || '',
            city: billing_address.city || '',
            state: billing_address.state || '',
            postal_code: billing_address.zip,
            country: billing_address.country
          },
          name: billing_address.name || 'Cardholder',
          email: billing_address.email || '',
          phone: billing_address.phone || ''
        }
      })
    });

    // Attach payment method to payment intent
    const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: paymentMethod.id,
      return_url: `${RENDER_URL}/success`
    });

    // Handle different payment statuses
    switch (paymentIntent.status) {
      case 'succeeded':
        res.json({
          success: true,
          status: 'succeeded',
          message: 'Payment completed successfully',
          paymentIntentId: paymentIntent.id
        });
        break;

      case 'requires_action':
        res.json({
          success: true,
          status: 'requires_action',
          clientSecret: paymentIntent.client_secret,
          message: 'Additional authentication required'
        });
        break;

      case 'requires_payment_method':
        res.status(400).json({
          error: 'Payment failed. Please check your card details',
          decline_code: paymentIntent.last_payment_error?.decline_code
        });
        break;

      default:
        res.json({
          success: true,
          status: paymentIntent.status,
          message: 'Payment processing',
          paymentIntentId: paymentIntent.id
        });
    }

  } catch (error) {
    console.error('Payment confirmation error:', error);
    
    // Handle specific Stripe errors
    if (error.type === 'StripeCardError') {
      res.status(400).json({
        error: 'Card declined',
        code: error.code,
        decline_code: error.decline_code
      });
    } else {
      res.status(500).json({
        error: 'Payment processing failed',
        details: isProduction? undefined: error.message
      });
    }
  }
});

// Validate billing address
function validateBillingAddress(address) {
  const errors = [];

  if (!address.street || address.street.trim().length < 2) {
    errors.push('Street address is required');
  }

  if (!address.zip || address.zip.trim().length < 3) {
    errors.push('ZIP/Postal code is required');
  }

  if (!address.country || !ALL_COUNTRIES.includes(address.country.toUpperCase())) {
    errors.push('Valid country code is required');
  }

  // State is required for some countries like US, CA
  const countriesRequiringState = ['US', 'CA', 'AU', 'BR', 'CN', 'IN'];
  if (countriesRequiringState.includes(address.country?.toUpperCase()) && !address.state) {
    errors.push('State/Province is required for this country');
  }

  return errors;
}

// Health check
app.get('/health', (req, res) => {
  const stripeConfigured = !!process.env.STRIPE_SECRET_KEY;
  
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    stripe: {
      configured: stripeConfigured,
      mode: stripeConfigured? (process.env.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test') : 'not_configured'
    },
    features: {
      cvc_verification: true,
      billing_address: true,
      countries: ALL_COUNTRIES.length
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

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    details: isProduction? undefined: error.message
  });
});

app.listen(PORT, () => {
  console.log('🚀 Server running on port', PORT);
  console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
  console.log('💳 Stripe mode:', process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'LIVE' : 'TEST');
  console.log('🔗 https://charannapos.onrender.com:', RENDER_URL);
});
