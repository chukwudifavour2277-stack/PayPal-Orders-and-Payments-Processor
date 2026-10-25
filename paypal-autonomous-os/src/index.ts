import { mkdir, writeFile } from 'node:fs/promises';
import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { getPayPalSandboxSummary, PayPalSummaryError } from './paypal-reporting';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Serve static frontend files from 'public' directory
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 3000;

// 1. Neuromorphic Behavioral Shield Middleware
function evaluateCognitiveShield(telemetry: { hourOfDay: number; stressIndex: number; typingCadenceVariance: number }) {
  if ((telemetry.hourOfDay >= 2 && telemetry.hourOfDay <= 5) && telemetry.stressIndex > 0.75) {
    return { safe: false, reason: 'Simulation paused: late-night fatigue and high stress detected. No funds were moved.' };
  }
  if (telemetry.typingCadenceVariance > 0.85) {
    return { safe: false, reason: 'Simulation paused: erratic cadence detected. No transaction or user verification was triggered.' };
  }
  return { safe: true };
}

// 2. Main Autonomous Intent Mesh Endpoint
app.post('/api/v1/mesh/orchestrate', async (req: Request, res: Response) => {
  try {
    const { userPrompt, userId, deviceTelemetry, iotSensorData } = req.body;

    const cognitiveCheck = evaluateCognitiveShield(deviceTelemetry || { hourOfDay: 14, stressIndex: 0.1, typingCadenceVariance: 0.1 });
    if (!cognitiveCheck.safe) {
      return res.status(403).json({ status: 'FROZEN', message: cognitiveCheck.reason });
    }

    let iotResult = null;
    if (userPrompt && (userPrompt.toLowerCase().includes('solar') || userPrompt.toLowerCase().includes('water') || iotSensorData)) {
      const sensor = iotSensorData || { nodeId: 'NODE-KANO-01', energyJoules: 14500, waterPurityTds: 42 };

      if (sensor.energyJoules > 10000 && sensor.waterPurityTds < 50) {
        iotResult = { status: 'SIMULATED_IOT_RELEASE', action: 'Simulation only: IoT conditions passed; no PayPal transaction was submitted.' };
      } else {
        iotResult = { status: 'SIMULATED_HOLD', reason: 'Simulation only: telemetry is below thresholds; no funds were held.' };
      }
    }

    const executionPlan = {
      intent: userPrompt || 'Default autonomous intent',
      LiquidityBreakdown: { flat: '50% simulated fiat allocation', yieldVault: '30% simulated savings allocation', stablecoin: '20% simulated USDC allocation' },
      iotEscrowStatus: iotResult || 'Simulation completed; no PayPal transaction was submitted.',
      timestamp: new Date().toISOString()
    };

    return res.status(200).json({ status: 'SUCCESS', executionPlan });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 3. Client Booking & Milestone Escrow Endpoint
app.post('/api/v1/bookings/create', async (req: Request, res: Response) => {
  try {
    const { clientId, freelancerId, projectScope, amountUSD } = req.body;

    const escrowRecord = {
      bookingId: `ESCROW-${Math.floor(Math.random() * 90000 + 100000)}`,
      clientId: clientId || 'CLI-DEMO',
      freelancerId: freelancerId || 'FREE-DEMO',
      projectScope: projectScope || 'General Service',
      amountUSD: amountUSD || 500,
      status: 'SIMULATED_BOOKING_CREATED',
      terms: 'Simulation only. No PayPal escrow was created and no funds were moved.',
      createdAt: new Date().toISOString()
    };

    return res.status(200).json({ status: 'SUCCESS', escrowRecord });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 4. Offline Concierge & Dispute Bridge Endpoint
app.post('/api/v1/disputes/offline-escalation', async (req: Request, res: Response) => {
  try {
    const { transactionId, userQuery, offlineReason } = req.body;

    const disputeTicket = {
      ticketId: `OFFLINE-DISPUTE-${Math.floor(Math.random() * 90000 + 100000)}`,
      transactionId: transactionId || 'TX-00000',
      userQuery: userQuery || 'General Inquiry',
      offlineReason: offlineReason || 'Human mediation requested',
      status: 'SIMULATED_OFFLINE_ESCALATION',
      message: 'Simulation only. No ticket was sent to PayPal or a support queue.',
      dispatchedAt: new Date().toISOString()
    };

    return res.status(200).json({ status: 'SUCCESS', disputeTicket });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/transactions/summary', async (req: Request, res: Response) => {
  try {
    const summary = await getPayPalSandboxSummary(req.body?.startDate, req.body?.endDate);
    return res.status(200).json({ status: 'SUCCESS', summary });
  } catch (error: unknown) {
    if (error instanceof PayPalSummaryError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return res.status(502).json({ error: 'PayPal Sandbox summary could not be generated.' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Elite PayPal Autonomous OS live on port ${PORT}`);
});
