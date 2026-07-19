/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Upload, MapPin, Activity, Loader2, FileText, Camera, Image as ImageIcon, X, Phone, ArrowRight, LogOut, History, Plus, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type AppState = 'idle' | 'listening' | 'processing' | 'speaking';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  hospitals?: { name: string; uri: string }[];
  file?: { data: string; mimeType: string; url: string; name: string };
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  timestamp: number;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [authStep, setAuthStep] = useState<'phone' | 'otp'>('phone');
  const [authPhone, setAuthPhone] = useState('');
  const [authOtp, setAuthOtp] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const [appState, setAppState] = useState<AppState>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const [showCamera, setShowCamera] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | AudioBufferSourceNode | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token');
    if (storedToken) {
      setToken(storedToken);
      fetchProfile(storedToken);
    } else {
      setIsAuthenticated(false);
    }
  }, []);

  // Load user-specific sessions when user is authenticated
  useEffect(() => {
    if (user?.phoneNumber) {
      const userSessionsKey = `chat_sessions_${user.phoneNumber}`;
      const storedSessions = localStorage.getItem(userSessionsKey);
      if (storedSessions) {
        try {
          const parsed = JSON.parse(storedSessions);
          setSessions(parsed);
          if (parsed.length > 0) {
            const latest = parsed.sort((a: any, b: any) => b.timestamp - a.timestamp)[0];
            setCurrentSessionId(latest.id);
            setMessages(latest.messages);
          } else {
            setMessages([]);
            setCurrentSessionId(null);
          }
        } catch (e) {
          console.error("Error parsing sessions", e);
          setSessions([]);
        }
      } else {
        setSessions([]);
        setMessages([]);
        setCurrentSessionId(null);
      }
    }
  }, [user]);

  // Save sessions to user-specific localStorage whenever they change
  useEffect(() => {
    if (user?.phoneNumber && sessions.length >= 0) {
      const userSessionsKey = `chat_sessions_${user.phoneNumber}`;
      localStorage.setItem(userSessionsKey, JSON.stringify(sessions));
    }
  }, [sessions, user]);

  // Update the current session's messages in the sessions list
  useEffect(() => {
    if (currentSessionId && messages.length > 0) {
      setSessions(prev => prev.map(s => 
        s.id === currentSessionId 
          ? { ...s, messages, timestamp: Date.now(), title: messages[0].text.substring(0, 30) + (messages[0].text.length > 30 ? '...' : '') } 
          : s
      ));
    } else if (!currentSessionId && messages.length > 0) {
      // Create a new session if we have messages but no ID
      const newId = Date.now().toString();
      const newSession: ChatSession = {
        id: newId,
        title: messages[0].text.substring(0, 30) + (messages[0].text.length > 30 ? '...' : ''),
        messages,
        timestamp: Date.now()
      };
      setSessions(prev => [newSession, ...prev]);
      setCurrentSessionId(newId);
    }
  }, [messages]);

  const startNewChat = () => {
    setMessages([]);
    setCurrentSessionId(null);
    setShowHistory(false);
  };

  const loadSession = (id: string) => {
    const session = sessions.find(s => s.id === id);
    if (session) {
      setMessages(session.messages);
      setCurrentSessionId(id);
      setShowHistory(false);
    }
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) {
      startNewChat();
    }
  };

  const fetchProfile = async (t: string) => {
    try {
      const res = await fetch('/api/auth/profile', {
        headers: { 'Authorization': `Bearer ${t}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setIsAuthenticated(true);
      } else {
        localStorage.removeItem('auth_token');
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error("Profile fetch error:", err);
      setIsAuthenticated(false);
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authPhone) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: authPhone })
      });
      const data = await res.json();
      if (res.ok) {
        setAuthStep('otp');
        if (data.debugOtp || data.error) {
          const debugMsg = data.debugOtp ? `DEBUG: Your OTP is ${data.debugOtp}.` : '';
          const errorMsg = data.error ? `\n\n${data.error}` : '';
          setAuthError(`${debugMsg}${errorMsg}`);
        }
      } else {
        setAuthError(data.error || 'Failed to send OTP');
      }
    } catch (err) {
      setAuthError('Network error. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authOtp) return;
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: authPhone, otp: authOtp })
      });
      const data = await res.json();
      if (res.ok) {
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem('auth_token', data.token);
        setIsAuthenticated(true);
      } else {
        setAuthError(data.error || 'Invalid OTP');
      }
    } catch (err) {
      setAuthError('Network error. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
    setAuthStep('phone');
    setAuthPhone('');
    setAuthOtp('');
    setSessions([]);
    setMessages([]);
    setCurrentSessionId(null);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showUploadMenu && !(event.target as Element).closest('.upload-menu-container')) {
        setShowUploadMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUploadMenu]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => console.warn("Geolocation error:", err)
      );
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, appState]);

  const getFriendlyErrorMessage = (err: any): string => {
    console.error("Detailed API Error:", err);
    
    // Check for network issues
    if (!navigator.onLine) {
      return "You appear to be offline. Please check your internet connection and try again.";
    }

    let message = "";
    let code = 0;

    // Extract message and code from various error formats
    if (err.message) message = err.message;
    if (err.status) code = err.status;
    if (err.error) {
      if (typeof err.error === 'string') message = err.error;
      else {
        if (err.error.message) message = err.error.message;
        if (err.error.code) code = err.error.code;
      }
    }

    const lowerMessage = message.toLowerCase();

    // 1. API Key Issues
    if (lowerMessage.includes('api key') || lowerMessage.includes('invalid_key') || code === 401 || code === 403) {
      return "There's an issue with the API configuration. Please ensure the Gemini API key is correctly set in the environment variables.";
    }

    // 2. Quota / Rate Limits
    if (code === 429 || lowerMessage.includes('429') || lowerMessage.includes('quota') || lowerMessage.includes('resource_exhausted')) {
      return "The AI service is currently at its limit. Please wait a minute before trying again, or consider upgrading your plan.";
    }

    // 3. Safety Filters
    if (lowerMessage.includes('safety') || lowerMessage.includes('blocked') || lowerMessage.includes('finish_reason_safety')) {
      return "I'm sorry, but I can't process that request as it triggered a safety filter. Please try rephrasing your query.";
    }

    // 4. Model Issues / 500s
    if (code >= 500 || lowerMessage.includes('internal') || lowerMessage.includes('service_unavailable')) {
      return "The AI service is temporarily unavailable. Our team has been notified. Please try again in a few minutes.";
    }

    // 5. Timeouts
    if (lowerMessage.includes('timeout') || lowerMessage.includes('deadline_exceeded')) {
      return "The request took too long to process. Please try a shorter query or check your connection.";
    }

    // 6. Default Fallback
    return message || "An unexpected error occurred while processing your request. Please try again.";
  };

  const startRecording = async () => {
    if (audioRef.current) {
      if ('pause' in audioRef.current) {
        audioRef.current.pause();
      } else if ('stop' in audioRef.current) {
        audioRef.current.stop();
      }
      audioRef.current = null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = (reader.result as string).split(',')[1];
          processInteraction({ base64Audio, audioMimeType: mimeType });
        };
      };

      mediaRecorder.start();
      setAppState('listening');
    } catch (err) {
      console.error("Microphone error:", err);
      alert("Please allow microphone access to use AarogyaVaani.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setAppState('processing');
    }
  };

  const playTTS = async (text: string, gender: string) => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: gender === 'female' ? 'Kore' : 'Puck' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        
        const binaryString = atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        const buffer = new ArrayBuffer(bytes.length);
        const view = new DataView(buffer);
        bytes.forEach((b, i) => view.setUint8(i, b));
        
        let audioBuffer: AudioBuffer;
        
        try {
           // Try to decode as WAV or other standard formats first
           audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
        } catch (e) {
           // Fallback to raw PCM 16-bit little endian (Gemini TTS default)
           audioBuffer = audioContext.createBuffer(1, bytes.length / 2, 24000);
           const channelData = audioBuffer.getChannelData(0);
           for (let i = 0; i < bytes.length / 2; i++) {
             const int16 = view.getInt16(i * 2, true);
             channelData[i] = int16 / 32768.0;
           }
        }
        
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        source.start();
        audioRef.current = source;
        
        return new Promise(resolve => {
          source.onended = resolve;
        });
      }
    } catch (e) {
      console.error("TTS Error", e);
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        window.speechSynthesis.speak(utterance);
        return new Promise(resolve => {
          utterance.onend = resolve;
          utterance.onerror = resolve;
        });
      }
    }
  };

  const processInteraction = async (input: { base64Audio?: string, audioMimeType?: string, textPrompt?: string, fileData?: any, skipUserMessageCreation?: boolean }) => {
    setAppState('processing');
    try {
      const parts: any[] = [];
      if (input.base64Audio && input.audioMimeType) {
        parts.push({ inlineData: { data: input.base64Audio, mimeType: input.audioMimeType } });
      }
      if (input.textPrompt) {
        parts.push({ text: input.textPrompt });
      }
      if (input.fileData) {
        parts.push({ inlineData: { data: input.fileData.data, mimeType: input.fileData.mimeType } });
      }

      const historyContents = messages.map(m => {
        const mParts: any[] = [];
        if (m.file) {
          mParts.push({ inlineData: { data: m.file.data, mimeType: m.file.mimeType } });
        }
        mParts.push({ text: m.text });
        return {
          role: m.role === 'user' ? 'user' : 'model',
          parts: mParts
        };
      });

      const responseStream = await ai.models.generateContentStream({
        model: 'gemini-3-flash-preview',
        contents: [
          ...historyContents,
          { role: 'user', parts }
        ],
        config: {
          systemInstruction: `You are AarogyaVaani, a production-grade voice-first healthcare assistant.
Your goals:
1. Help users express symptoms clearly and suggest the type of specialist they should see.
2. Explain medical reports/prescriptions simply. You ARE ALLOWED to read, summarize, and explain the contents of uploaded medical reports. Translate medical jargon into simple terms. This is for educational purposes.
3. NEVER provide a definitive medical diagnosis or prescribe treatment. Always include a disclaimer to consult a doctor.
4. Respond in the SAME language the user speaks (or the language of the uploaded document).
5. Keep responses concise, conversational, and human-like.

IMPORTANT FORMATTING:
You must start your response with two tags:
1. [GENDER:male] or [GENDER:female] or [GENDER:unknown] (based on the user's voice, or unknown if no voice)
2. [TRANSCRIPT: <user's spoken text in their language, or "Report uploaded" if no voice>]

After the tags, provide your conversational response.

If the user speaks their symptoms:
- Explain the symptoms simply.${location ? '\n- ALWAYS use the googleMaps tool to find nearby hospitals and clinics, and mention them in your response.' : ''}

If the user uploads a medical report or prescription:
- FIRST, acknowledge the upload and ask the user what language they would like the explanation in. Do not explain the report yet.
- Once the user specifies the language, read and explain the findings simply in that requested language.
- Highlight key points (e.g., abnormal values, prescribed medications).
- Suggest general precautions (do's and don'ts) related to the findings.

If the user asks a follow-up question, refer back to the previously uploaded medical reports in the chat history to answer their question accurately.

Write the response so it sounds natural when spoken aloud. Avoid complex formatting like markdown tables.`,
          tools: location ? [{ googleMaps: {} }] : undefined,
          toolConfig: location ? {
            retrievalConfig: {
              latLng: {
                latitude: location.lat,
                longitude: location.lng
              }
            }
          } : undefined
        }
      });

      let fullText = '';
      let gender = 'unknown';
      let transcript = 'Audio received';
      let cleanReply = '';
      let hospitals: {name: string, uri: string}[] = [];
      let assistantMsgId = (Date.now() + 1).toString();

      // Create a placeholder message for streaming
      setMessages(prev => [...prev, {
        id: assistantMsgId,
        role: 'assistant',
        text: '...',
      }]);

      for await (const chunk of responseStream) {
        const chunkText = chunk.text || '';
        fullText += chunkText;

        // Extract tags if not already extracted
        if (gender === 'unknown') {
          const genderMatch = fullText.match(/\[GENDER:(.*?)\]/i);
          if (genderMatch) gender = genderMatch[1].trim().toLowerCase();
        }
        if (transcript === 'Audio received') {
          const transcriptMatch = fullText.match(/\[TRANSCRIPT:(.*?)\]/i);
          if (transcriptMatch) transcript = transcriptMatch[1].trim();
        }

        // Update the clean reply
        cleanReply = fullText.replace(/\[GENDER:.*?\]/i, '').replace(/\[TRANSCRIPT:.*?\]/i, '').trim();

        // Update the message in real-time
        setMessages(prev => prev.map(m => 
          m.id === assistantMsgId ? { ...m, text: cleanReply || '...' } : m
        ));

        // Extract hospitals if grounding metadata is available
        const groundingChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (groundingChunks) {
          const seenUris = new Set<string>();
          for (const gChunk of groundingChunks) {
            let name = '';
            let uri = '';
            if (gChunk.web?.uri && gChunk.web?.title) {
              name = gChunk.web.title;
              uri = gChunk.web.uri;
            } else if (gChunk.maps?.uri) {
              name = gChunk.maps.title || 'View on Google Maps';
              uri = gChunk.maps.uri;
            }
            if (uri && !seenUris.has(uri)) {
              seenUris.add(uri);
              hospitals.push({ name, uri });
            }
          }
          if (hospitals.length > 0) {
            setMessages(prev => prev.map(m => 
              m.id === assistantMsgId ? { ...m, hospitals } : m
            ));
          }
        }
      }

      if (!input.skipUserMessageCreation) {
        const userMsgId = Date.now().toString();
        setMessages(prev => {
          // Find the assistant message we just added and insert user message before it
          const newMessages = [...prev];
          const assistantIndex = newMessages.findIndex(m => m.id === assistantMsgId);
          newMessages.splice(assistantIndex, 0, {
            id: userMsgId,
            role: 'user',
            text: transcript
          });
          return newMessages;
        });
      }

      setAppState('speaking');
      await playTTS(cleanReply, gender);
      setAppState('idle');

    } catch (err: any) {
      setAppState('idle');
      const friendlyMessage = getFriendlyErrorMessage(err);
      
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        text: `Error: ${friendlyMessage}`
      }]);
    }
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("Could not access camera. Please ensure permissions are granted.");
      setShowCamera(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setShowCamera(false);
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg');
        const base64 = dataUrl.split(',')[1];

        const fileData = {
          data: base64,
          mimeType: 'image/jpeg',
          name: `camera_capture_${Date.now()}.jpg`,
          url: dataUrl
        };

        const userMsgId = Date.now().toString();
        setMessages(prev => [...prev, {
          id: userMsgId,
          role: 'user',
          text: `Uploaded report: ${fileData.name}`,
          file: fileData
        }]);

        setAppState('processing');
        processInteraction({
          textPrompt: "I have uploaded a medical report. Please acknowledge the upload and ask me what language I would like the explanation in. Keep it brief.",
          fileData: fileData,
          skipUserMessageCreation: true
        });
      }
    }
    stopCamera();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 4 * 1024 * 1024) {
      alert("File is too large. Please upload a file smaller than 4MB.");
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setAppState('processing');

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      
      let mimeType = file.type;
      if (!mimeType) {
        if (file.name.toLowerCase().endsWith('.pdf')) mimeType = 'application/pdf';
        else if (file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg')) mimeType = 'image/jpeg';
        else if (file.name.toLowerCase().endsWith('.png')) mimeType = 'image/png';
        else mimeType = 'application/pdf';
      }

      const fileData = {
        data: base64,
        mimeType: mimeType,
        name: file.name,
        url: URL.createObjectURL(file)
      };

      const userMsgId = Date.now().toString();
      setMessages(prev => [...prev, {
        id: userMsgId,
        role: 'user',
        text: `Uploaded report: ${file.name}`,
        file: fileData
      }]);

      processInteraction({
        textPrompt: "I have uploaded a medical report. Please acknowledge the upload and ask me what language I would like the explanation in. Keep it brief.",
        fileData: fileData,
        skipUserMessageCreation: true
      });
    };
    reader.readAsDataURL(file);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (cameraInputRef.current) {
      cameraInputRef.current.value = '';
    }
  };

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen relative flex flex-col items-center justify-center p-6 font-sans antialiased overflow-hidden">
        {/* Background Elements */}
        <div 
          className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-60 pointer-events-none"
          style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&q=80&w=2070")' }}
        />
        <div className="fixed inset-0 z-0 bg-gradient-to-br from-white/40 to-brand-50/30 backdrop-blur-[1px] pointer-events-none" />
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl shadow-brand-200/50 p-10 border border-brand-100"
        >
          <div className="flex flex-col items-center text-center space-y-6 mb-10">
            <div className="w-full overflow-hidden rounded-3xl shadow-lg border border-brand-100">
              <img 
                src="https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&q=80&w=1000" 
                alt="Healthcare Professional"
                className="w-full h-40 object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="bg-gradient-to-tr from-brand-600 to-brand-500 p-4 rounded-3xl shadow-xl shadow-brand-500/30 ring-1 ring-white/30 -mt-12 relative z-10">
              <Activity className="text-white w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-black text-slate-900 tracking-tight font-display">AarogyaVaani</h1>
              <p className="text-slate-500 font-medium">Your AI-powered health companion</p>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {authStep === 'phone' ? (
              <motion.form 
                key="phone"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                onSubmit={handleSendOtp}
                className="space-y-6"
              >
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 ml-1">Phone Number</label>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input 
                      type="tel" 
                      placeholder="+91 98765 43210"
                      value={authPhone}
                      onChange={(e) => setAuthPhone(e.target.value)}
                      className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none font-medium"
                      required
                    />
                  </div>
                  <p className="text-xs text-slate-400 ml-1">Include country code (e.g., +91 for India)</p>
                </div>
                {authError && <p className="text-red-500 text-sm font-medium text-center">{authError}</p>}
                <button 
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-4 bg-brand-600 hover:bg-brand-700 text-white rounded-2xl font-bold shadow-lg shadow-brand-600/30 transition-all flex items-center justify-center gap-2 group disabled:opacity-50"
                >
                  {authLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                    <>
                      Send OTP
                      <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </motion.form>
            ) : (
              <motion.form 
                key="otp"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                onSubmit={handleVerifyOtp}
                className="space-y-6"
              >
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 ml-1">Enter 6-digit OTP</label>
                  <input 
                    type="text" 
                    placeholder="000000"
                    maxLength={6}
                    value={authOtp}
                    onChange={(e) => setAuthOtp(e.target.value)}
                    className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-all outline-none font-medium text-center text-2xl tracking-[0.5em]"
                    required
                  />
                  <p className="text-xs text-slate-400 text-center mt-2">Sent to {authPhone}</p>
                </div>
                {authError && <p className="text-red-500 text-sm font-medium text-center">{authError}</p>}
                <div className="space-y-3">
                  <button 
                    type="submit"
                    disabled={authLoading}
                    className="w-full py-4 bg-brand-600 hover:bg-brand-700 text-white rounded-2xl font-bold shadow-lg shadow-brand-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {authLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Verify & Login"}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setAuthStep('phone')}
                    className="w-full py-2 text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Change Phone Number
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex flex-col font-sans selection:bg-brand-100 selection:text-brand-900 antialiased">
      {/* Background Image with Overlay */}
      <div 
        className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-40 pointer-events-none"
        style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1584982751601-97dcc096659c?auto=format&fit=crop&q=80&w=2070")' }}
      />
      <div className="fixed inset-0 z-0 bg-gradient-to-br from-slate-900/40 via-slate-800/20 to-brand-900/30 pointer-events-none" />

      <header className="bg-white shadow-sm py-5 px-8 flex items-center justify-between sticky top-0 z-20 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-brand-600 to-brand-500 p-2 rounded-xl shadow-lg shadow-brand-500/20 ring-1 ring-white/30 animate-pulse-subtle">
            <Activity className="text-white w-5 h-5" />
          </div>
          <h1 className="text-2xl font-bold text-black tracking-tight font-display">AarogyaVaani</h1>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={logout}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-slate-500 hover:text-red-500 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>
          
          <button 
            onClick={() => setShowHistory(!showHistory)} 
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-black bg-slate-50 rounded-full hover:bg-slate-100 hover:shadow-sm transition-all border border-slate-200 backdrop-blur-md"
          >
            <History className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">History</span>
          </button>

          <div className="relative upload-menu-container">
            <button onClick={() => setShowUploadMenu(!showUploadMenu)} className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-black bg-slate-50 rounded-full hover:bg-slate-100 hover:shadow-sm transition-all border border-slate-200 backdrop-blur-md">
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Upload Report</span>
            </button>
            
            {showUploadMenu && (
              <motion.div 
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="absolute right-0 mt-3 w-56 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden z-50"
              >
                <button 
                  onClick={() => {
                    startCamera();
                    setShowUploadMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700 transition-colors text-left"
                >
                  <Camera className="w-4 h-4 text-brand-600" />
                  Take Photo
                </button>
                <button 
                  onClick={() => {
                    fileInputRef.current?.click();
                    setShowUploadMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700 transition-colors text-left border-t border-slate-50"
                >
                  <ImageIcon className="w-4 h-4 text-brand-600" />
                  Choose from Gallery
                </button>
                <button 
                  onClick={() => {
                    fileInputRef.current?.click();
                    setShowUploadMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700 transition-colors text-left border-t border-slate-50"
                >
                  <FileText className="w-4 h-4 text-brand-600" />
                  Upload Document
                </button>
              </motion.div>
            )}
          </div>
        </div>
        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*,application/pdf" className="hidden" />
        <input type="file" ref={cameraInputRef} onChange={handleFileUpload} accept="image/*" capture="environment" className="hidden" />
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 pb-36 max-w-4xl mx-auto w-full scroll-smooth">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-[70vh] text-center space-y-8">
            <div className="space-y-4">
              <h2 className="text-6xl font-black text-brand-600 tracking-tight leading-tight font-display">
                How can I help you today?
              </h2>
              <p className="text-slate-700 max-w-md text-2xl leading-relaxed font-bold mx-auto tracking-tight">
                Tap to speak or describe your symptoms for instant health guidance.
              </p>
            </div>
          </div>
        )}

        {messages.map(msg => (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            key={msg.id}
            className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            {msg.file && (
              <div className="mb-2">
                {msg.file.mimeType.startsWith('image/') ? (
                  <img src={msg.file.url} alt="Uploaded report" className="max-w-[240px] rounded-2xl shadow-sm border border-slate-200/60 object-cover" />
                ) : (
                  <div className="flex items-center gap-3 p-3.5 bg-white rounded-2xl border border-slate-200/60 shadow-sm text-slate-700">
                    <div className="p-2 bg-brand-50 rounded-xl">
                      <FileText className="w-5 h-5 text-brand-600" />
                    </div>
                    <span className="text-sm font-medium truncate max-w-[150px]">{msg.file.name}</span>
                  </div>
                )}
              </div>
            )}
            <div className={`max-w-[85%] md:max-w-[80%] p-5 md:p-6 rounded-[2.5rem] shadow-sm ${
              msg.role === 'user'
                ? 'bg-gradient-to-br from-brand-600 to-brand-500 text-white rounded-tr-none shadow-xl shadow-brand-500/20 ring-1 ring-white/10'
                : 'bg-white/70 backdrop-blur-xl text-slate-800 border border-white/50 shadow-2xl shadow-slate-200/40 rounded-tl-none ring-1 ring-white/20'
            }`}>
              <p className="whitespace-pre-wrap leading-relaxed text-[16px] font-medium tracking-tight">{msg.text}</p>

              {msg.hospitals && msg.hospitals.length > 0 && (
                <div className="mt-5 space-y-2.5">
                  <p className="font-semibold text-xs text-slate-400 uppercase tracking-widest">Nearby Hospitals</p>
                  {msg.hospitals.map((h, i) => (
                    <a
                      key={i}
                      href={h.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-50/50 hover:bg-brand-50/50 transition-colors border border-slate-100 hover:border-brand-100/50 group"
                    >
                      <div className="p-2 bg-white rounded-full shadow-sm group-hover:bg-brand-50 transition-colors">
                        <MapPin className="w-4 h-4 text-brand-500" />
                      </div>
                      <span className="text-sm font-medium text-slate-700 line-clamp-2">{h.name}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        ))}


        <div ref={messagesEndRef} />
      </main>

      <div className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent flex justify-center pb-10 pointer-events-none">
        <div className="relative flex items-center justify-center pointer-events-auto">
          {messages.length > 0 && appState === 'idle' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute -top-16 text-sm text-brand-700 font-bold bg-white/90 px-6 py-2.5 rounded-full shadow-xl border border-brand-100/50 backdrop-blur-md whitespace-nowrap ring-1 ring-brand-500/10"
            >
              Tap to ask a follow-up
            </motion.div>
          )}
          {appState === 'idle' && (
            <motion.div
              animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.1, 0.2] }}
              transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
              className="absolute inset-0 bg-brand-400 rounded-full blur-xl"
            />
          )}
          {appState === 'listening' && (
            <motion.div
              animate={{ scale: [1, 1.6, 1], opacity: [0.4, 0, 0.4] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
              className="absolute inset-0 bg-red-400 rounded-full blur-xl"
            />
          )}
          {appState === 'speaking' && (
            <motion.div
              animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
              transition={{ repeat: Infinity, duration: 1.8 }}
              className="absolute inset-0 bg-brand-400 rounded-full blur-xl"
            />
          )}

          <button
            onClick={appState === 'idle' || appState === 'speaking' ? startRecording : stopRecording}
            disabled={appState === 'processing'}
            className={`relative z-10 flex items-center justify-center w-24 h-24 rounded-[2.5rem] shadow-2xl transition-all duration-500 active:scale-95 ${
              appState === 'listening' ? 'bg-red-500 text-white scale-110 shadow-red-500/40 rotate-90' :
              appState === 'processing' ? 'bg-slate-200 text-slate-400 cursor-not-allowed' :
              appState === 'speaking' ? 'bg-gradient-to-tr from-brand-500 to-brand-400 text-white shadow-brand-500/40 ring-4 ring-brand-100' :
              'bg-gradient-to-tr from-brand-600 to-brand-500 text-white hover:from-brand-700 hover:to-brand-600 hover:scale-110 shadow-brand-600/30 ring-4 ring-white/50'
            }`}
          >
            {appState === 'idle' && <Mic className="w-10 h-10" />}
            {appState === 'listening' && <Square className="w-10 h-10 fill-current" />}
            {appState === 'processing' && <Loader2 className="w-10 h-10 animate-spin" />}
            {appState === 'speaking' && <Activity className="w-10 h-10 animate-pulse" />}
          </button>
        </div>
      </div>

      {showCamera && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            className="w-full h-full object-cover"
          />
          <div className="absolute bottom-10 left-0 right-0 flex justify-center items-center gap-8">
            <button 
              onClick={stopCamera}
              className="p-4 bg-slate-800/50 text-white rounded-full backdrop-blur-sm hover:bg-slate-700/50 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
            <button 
              onClick={capturePhoto}
              className="w-20 h-20 bg-white rounded-full border-4 border-slate-300 flex items-center justify-center hover:scale-105 transition-transform"
            >
              <div className="w-16 h-16 bg-white rounded-full border-2 border-slate-800" />
            </button>
            <div className="w-14" />
          </div>
        </div>
      )}

      {/* History Sidebar/Drawer */}
      <AnimatePresence>
        {showHistory && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-xs bg-white shadow-2xl z-[70] flex flex-col border-l border-slate-100"
            >
              <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900">Chat History</h2>
                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>

              <div className="p-4">
                <button 
                  onClick={startNewChat}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold shadow-lg shadow-brand-600/20 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  New Chat
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {sessions.length === 0 ? (
                  <div className="text-center py-10">
                    <p className="text-slate-400 font-medium">No history yet</p>
                  </div>
                ) : (
                  sessions.sort((a, b) => b.timestamp - a.timestamp).map(session => (
                    <div 
                      key={session.id}
                      onClick={() => loadSession(session.id)}
                      className={`group relative p-4 rounded-2xl border transition-all cursor-pointer ${
                        currentSessionId === session.id 
                          ? 'bg-brand-50 border-brand-200 ring-1 ring-brand-200' 
                          : 'bg-white border-slate-100 hover:border-brand-100 hover:bg-slate-50'
                      }`}
                    >
                      <div className="pr-8">
                        <p className={`text-sm font-bold truncate ${currentSessionId === session.id ? 'text-brand-900' : 'text-slate-700'}`}>
                          {session.title}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-1 font-medium">
                          {new Date(session.timestamp).toLocaleDateString()} • {new Date(session.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <button 
                        onClick={(e) => deleteSession(e, session.id)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 rounded-lg transition-all text-slate-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
