import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import twilio from "twilio";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

// In-memory OTP store (for demo/prototype purposes)
const otpStore = new Map<string, { otp: string; expires: number }>();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // 1. Security & Middleware
  app.use(helmet({
    contentSecurityPolicy: false, // Disable for Vite dev server compatibility
  }));
  app.use(cors());
  app.use(morgan("dev"));
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // 2. Dedicated API Routes
  const apiRouter = express.Router();

  // Health Check
  apiRouter.get("/health", (req, res) => {
    res.json({ 
      status: "online", 
      version: "1.0.0",
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString() 
    });
  });

  // --- Authentication Routes ---

  // Send OTP
  apiRouter.post("/auth/send-otp", async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: "Phone number is required" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 5 * 60 * 1000; // 5 minutes
    otpStore.set(phoneNumber, { otp, expires });

    console.log(`[AUTH] Generated OTP for ${phoneNumber}: ${otp}`);

    // Attempt to send via Twilio
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
      try {
        const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        
        // Robust E.164 formatting
        let to = phoneNumber.replace(/\s+/g, '');
        if (!to.startsWith('+')) {
          // If it's a 10-digit number, assume India (+91) as a common default for this user
          if (to.length === 10) {
            to = `+91${to}`;
          } else {
            to = `+${to}`;
          }
        }

        await client.messages.create({
          body: `Your Health AI verification code is: ${otp}`,
          from: TWILIO_PHONE_NUMBER,
          to: to
        });
        return res.json({ message: "OTP sent successfully" });
      } catch (err: any) {
        console.error(`[AUTH] Twilio Error for ${phoneNumber}:`, err.message);
        // Fallback for trial accounts or missing config: provide debug info
        return res.status(200).json({ 
          message: "OTP generated (Twilio failed)", 
          debugOtp: otp,
          error: "Twilio error: " + err.message + ". Please use the debug OTP for testing."
        });
      }
    } else {
      return res.json({ 
        message: "OTP generated (Twilio not configured)", 
        debugOtp: otp 
      });
    }
  });

  // Verify OTP
  apiRouter.post("/auth/verify-otp", (req, res) => {
    const { phoneNumber, otp } = req.body;
    const stored = otpStore.get(phoneNumber);

    if (!stored || stored.otp !== otp || Date.now() > stored.expires) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    otpStore.delete(phoneNumber);

    const token = jwt.sign({ phoneNumber }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ 
      token, 
      user: { uid: phoneNumber, phoneNumber } 
    });
  });

  // Middleware to verify JWT
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  };

  // Get Profile (Protected)
  apiRouter.get("/auth/profile", authenticateToken, (req: any, res) => {
    res.json({ user: req.user });
  });

  // Placeholder for STT / Audio Processing
  apiRouter.post("/process-audio", (req, res) => {
    const { audioData, mimeType } = req.body;
    if (!audioData) {
      return res.status(400).json({ error: "No audio data provided" });
    }
    
    // In a real-world system, you could perform additional processing here
    // (e.g., logging, validation, or calling a specialized STT service)
    res.json({ 
      message: "Audio received for processing",
      receivedSize: audioData.length,
      mimeType: mimeType
    });
  });

  app.use("/api", apiRouter);

  // 3. Frontend Integration (Vite or Static Files)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // 4. Error Handling
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: "Internal Server Error", message: err.message });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Backend] Dedicated server running on http://localhost:${PORT}`);
    console.log(`[Backend] API endpoints available at /api/*`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
