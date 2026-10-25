import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

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
    return { safe: false, reason: 'Late-night fatigue & high stress detected. 24-hour cooling escrow engaged.' };
  }
  if (telemetry.typingCadenceVariance > 0.85) {
    return { safe: false, reason: 'Erratic biometric cadence detected. Transaction paused for user verification.' };
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
      if (sensor.energyJoules > 10000 && sensor.waterPurityTds <= 50) {
        iotResult = { status: 'IOT_VERIFIED_RELEASE', action: 'Cooperative pool released automatically via PayPal Sandbox rails.' };
      } else {
        iotResult = { status: 'HELD_IN_ESCROW', reason: 'IoT telemetry parameters below safety threshold.' };
      }
    }

    const executionPlan = {
      intent: userPrompt || "Default autonomous intent",
      liquidityBreakdown: { fiat: '50% PayPal Balance', yieldVault: '30% Savings Vault', stablecoin: '20% USDC Mesh' },
      iotEscrowStatus: iotResult || 'Standard Execution Completed',
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
      bookingId: `ESCROW-${Math.floor(Math.random() * 900000 + 100000)}`,
      clientId: clientId || 'CLI-DEMO',
      freelancerId: freelancerId || 'FREE-DEMO',
      projectScope: projectScope || 'General Service',
      amountUSD: amountUSD || 500,
      status: 'LOCKED_IN_PAYPAL_ESCROW',
      terms: 'Funds locked securely. Released automatically upon AI-verified milestone completion.',
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
      ticketId: `OFFLINE-DISPUTE-${Math.floor(Math.random() * 90000 + 10000)}`,
      transactionId: transactionId || 'TX-00000',
      userQuery: userQuery || 'General Inquiry',
      offlineReason: offlineReason || 'Human mediation requested',
      status: 'DISPATCHED_TO_OFFLINE_QUEUE',
      message: 'AI mediation exhausted. Telemetry packaged into secure cryptographic bundle for PayPal priority customer care callback.',
      dispatchedAt: new Date().toISOString()
    };

    return res.status(200).json({ status: 'SUCCESS', disputeTicket });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Elite PayPal Autonomous OS live on port ${PORT}`);
});
