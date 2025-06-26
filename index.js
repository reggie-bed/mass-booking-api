// index.js

require('dotenv').config();
const express    = require('express');
const mongoose   = require('mongoose');
const bodyParser = require('body-parser');
const cors       = require('cors');

const Booking    = require('./models/Booking');

const app = express();
const PORT = process.env.PORT || 5000;

// ===== Middleware =====
app.use(cors());                       // Enable CORS for all origins
app.use(bodyParser.json());            // Parse JSON request bodies

// ===== Connect to MongoDB =====
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// ===== Routes =====

// 1. Create a new booking
//    POST /api/bookings
app.post('/api/bookings', async (req, res) => {
  try {
    // Generate a refId if not provided (for Paystack flow, refId equals paymentId)
    const { paymentId, ...rest } = req.body;
    const refId = rest.refId || paymentId;

    const newBooking = new Booking({
      refId,
      paymentId,
      ...rest
    });

    await newBooking.save();
    return res.status(201).json(newBooking);
  } catch (error) {
    console.error('Error creating booking:', error);
    return res.status(400).json({ message: error.message });
  }
});

// ===== 2. Paystack webhook endpoint =====
app.post('/api/bookings/webhook/paystack', async (req, res) => {
  console.log('📬 Webhook hit w/ payload:', JSON.stringify(req.body).slice(0,200));
  const event = req.body;

  if (event.event === 'charge.success') {
    const reference = event.data.reference;
    try {
      const booking = await Booking.findOneAndUpdate(
        { paymentId: reference },
        { status: 'paid' },
        { new: true }
      );
      if (!booking) {
        console.log(`❓ No booking for paymentId ${reference}`);
      } else {
        console.log(`✔️ Booking ${booking._id} updated to paid.`);

        // DEBUG: mailOptions
        const mailOptions = {
          from: `"St. Catherine Parish" <${process.env.GMAIL_USER}>`,
          to:   booking.email,
          subject: 'Your Mass Booking is Confirmed',
          text: `Hello ${booking.name}, your booking is confirmed!`
        };
        console.log('➤ [DEBUG] mailOptions:', {
          from: mailOptions.from,
          to:   mailOptions.to,
          subj: mailOptions.subject
        });

        try {
          const info = await transporter.sendMail(mailOptions);
          console.log(`✅ Email sent: ${info.messageId}`);
        } catch (mailErr) {
          console.error('❌ Error sending email:', mailErr);
        }
      }
    } catch (err) {
      console.error('❌ Error in webhook handler:', err);
    }
  } else {
    console.log('⚠️ Webhook received but event != charge.success:', event.event);
  }

  res.status(200).send('Webhook received');
});


// 3. (Optional) Get bookings by status
//    GET /api/bookings?status=office_pending
app.get('/api/bookings', async (req, res) => {
  const { status } = req.query;
  try {
    const filter = status ? { status } : {};
    const bookings = await Booking.find(filter).sort({ createdAt: -1 });
    return res.json(bookings);
  } catch (err) {
    console.error('Error fetching bookings:', err);
    return res.status(500).json({ message: err.message });
  }
});

// 4. Verify office‐payment manually (PATCH)
//    PATCH /api/bookings/:id/verify
app.patch('/api/bookings/:id/verify', async (req, res) => {
  try {
    const booking = await Booking.findByIdAndUpdate(
      req.params.id,
      { status: 'paid' },
      { new: true }
    );
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    return res.json(booking);
  } catch (error) {
    console.error('Error verifying booking:', error);
    return res.status(400).json({ message: error.message });
  }
});

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
