// index.js

require('dotenv').config();
const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const nodemailer = require('nodemailer');

const Booking = require('./models/Booking');

const app  = express();
const PORT = process.env.PORT || 5000;

// ===== Middleware =====
app.use(cors());
app.use(express.json());

// ===== Connect to MongoDB =====
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ===== Gmail transporter =====
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// ===== 1. Create a new booking =====
app.post('/api/bookings', async (req, res) => {
  try {
    const { paymentId, ...rest } = req.body;
    const refId = rest.refId || paymentId;
    const newBooking = new Booking({ refId, paymentId, ...rest });
    await newBooking.save();
    return res.status(201).json(newBooking);
  } catch (error) {
    console.error('Error creating booking:', error);
    return res.status(400).json({ message: error.message });
  }
});

// ===== 2. Paystack webhook endpoint =====
app.post('/api/bookings/webhook/paystack', async (req, res) => {
  const event = req.body;

  if (event.event === 'charge.success') {
    const reference = event.data.reference;
    try {
      const booking = await Booking.findOneAndUpdate(
        { paymentId: reference },
        { status: 'paid' },
        { new: true }
      );

      if (booking) {
        // send confirmation email...
        const mailOptions = {
          from: `"St. Catherine Parish" <${process.env.GMAIL_USER}>`,
          to: booking.email,
          subject: '📖 Your Mass Booking is Confirmed!',
          text: `
Hi ${booking.name},

Your booking is confirmed!

Ref: ${booking.refId}
Date: ${new Date(booking.startDate).toLocaleDateString()}${booking.endDate ? ' to ' + new Date(booking.endDate).toLocaleDateString() : ''}
Time: ${booking.time}
Amount: ₦${booking.amount}
Intentions: ${booking.intention}

God bless,
St. Catherine Parish
          `,
          html: `<div>…</div>` // (same as before)
        };
        await transporter.sendMail(mailOptions);
      }
    } catch (err) {
      console.error('Error updating booking status or sending email:', err);
    }
  }

  return res.status(200).send('Webhook received');
});

// 3. List bookings, filter by status AND only those overlapping [dateFrom, dateTo]
app.get('/api/bookings', async (req, res) => {
  const { status, dateFrom, dateTo } = req.query;

  try {
    const filter = {};
    if (status) {
      filter.status = status;
    }

    if (dateFrom || dateTo) {
      // normalize our window
      const from = dateFrom
        ? new Date(dateFrom)
        : new Date(0);
      const to = dateTo
        ? new Date(new Date(dateTo).setHours(23,59,59,999))
        : new Date('9999-12-31');

      // only bookings whose [startDate, endDate] overlaps [from, to]
      filter.startDate = { $lte: to };
      filter.endDate   = { $gte: from };
    }

    const bookings = await Booking.find(filter).sort({ startDate: 1 });
    return res.json(bookings);
  } catch (err) {
    console.error('Error fetching bookings:', err);
    return res.status(500).json({ message: err.message });
  }
});

// ===== 4. Delete a booking =====
app.delete('/api/bookings/:id', async (req, res) => {
  try {
    const result = await Booking.findByIdAndDelete(req.params.id);
    if (!result) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    return res.json({ message: 'Booking deleted (cannot be recovered)' });
  } catch (err) {
    console.error('Error deleting booking:', err);
    return res.status(500).json({ message: err.message });
  }
});

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
