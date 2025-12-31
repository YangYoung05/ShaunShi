import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { 
  createPcmBlob, 
  decode, 
  decodeAudioData, 
  blobToBase64 
} from './utils/audioUtils';
import { MemoryService } from './utils/memoryService';
import { TOOLS_DECLARATION, LogEntry, MemoryItem, AROverlayData } from './types';
import { Visualizer } from './components/Visualizer';

// --- Constants ---
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';
const SAMPLE_RATE_IN = 16000;
const SAMPLE_RATE_OUT = 24000;
const FRAME_RATE = 1; 

// --- Component: Device Selector ---
const DeviceSelector = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  audioDevices, 
  videoDevices 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onConfirm: (audioId: string, videoId: string) => void;
  audioDevices: MediaDeviceInfo[];
  videoDevices: MediaDeviceInfo[];
}) => {
  const [selectedAudio, setSelectedAudio] = useState('');
  const [selectedVideo, setSelectedVideo] = useState('');

  useEffect(() => {
    if (audioDevices.length > 0 && !selectedAudio) setSelectedAudio(audioDevices[0].deviceId);
    if (videoDevices.length > 0 && !selectedVideo) setSelectedVideo(videoDevices[0].deviceId);
  }, [audioDevices, videoDevices, selectedAudio, selectedVideo]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <div className="bg-slate-900 border border-cyan-500/50 p-6 rounded-lg w-full max-w-md shadow-[0_0_50px_rgba(6,182,212,0.2)]">
        <h2 className="text-xl font-bold text-cyan-400 mb-4 tracking-widest uppercase border-b border-slate-800 pb-2">
          建立神经连接
        </h2>
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">听觉节点 (Mic)</label>
            <select 
              value={selectedAudio}
              onChange={(e) => setSelectedAudio(e.target.value)}
              className="w-full bg-slate-800 text-cyan-100 border border-slate-700 rounded p-2 text-sm focus:border-cyan-500 outline-none"
            >
              {audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0,4)}`}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">视觉节点 (Cam)</label>
            <select 
              value={selectedVideo}
              onChange={(e) => setSelectedVideo(e.target.value)}
              className="w-full bg-slate-800 text-cyan-100 border border-slate-700 rounded p-2 text-sm focus:border-cyan-500 outline-none"
            >
              {videoDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Cam ${d.deviceId.slice(0,4)}`}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-slate-400 hover:text-white text-sm uppercase">取消</button>
          <button onClick={() => onConfirm(selectedAudio, selectedVideo)} className="px-6 py-2 bg-cyan-900/40 text-cyan-400 border border-cyan-500/50 rounded hover:bg-cyan-500 hover:text-black transition-all font-bold text-sm uppercase shadow-[0_0_15px_rgba(6,182,212,0.3)]">
            启动系统
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  // --- State ---
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [hasPermission, setHasPermission] = useState(false);
  const [arOverlays, setArOverlays] = useState<AROverlayData[]>([]);
  
  // Device Selection
  const [showDeviceSelector, setShowDeviceSelector] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);

  // --- Refs ---
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  // Audio & Connection Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Stability & State Refs
  const sessionRef = useRef<any>(null);
  const isStreamingRef = useRef(false);
  const nextStartTimeRef = useRef<number>(0);
  const frameIntervalRef = useRef<number | null>(null);
  const activeAudioIdRef = useRef<string>('');
  const activeVideoIdRef = useRef<string>('');
  const isUserDisconnectingRef = useRef<boolean>(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionAttemptIdRef = useRef<number>(0); // To prevent race conditions

  // --- Logging ---
  const addLog = useCallback((message: string, source: LogEntry['source'] = 'SYSTEM', type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString('zh-CN'),
      source,
      message,
      type
    }]);
  }, []);

  // --- Init ---
  useEffect(() => {
    setMemories(MemoryService.load());
    addLog("Jarvis 内核初始化...", "SYSTEM");
    
    // Initial permission check
    navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      .then(() => {
        setHasPermission(true);
        addLog("生物特征传感器权限已获取。", "SYSTEM", "success");
      })
      .catch(() => addLog("权限被拒绝。请检查浏览器设置。", "SYSTEM", "error"));

    return () => {
      isUserDisconnectingRef.current = true;
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // --- AR Render Loop ---
  useEffect(() => {
    const renderAR = () => {
      const canvas = overlayCanvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const now = Date.now();
      const activeOverlays = arOverlays.filter(o => now - o.timestamp < 3000);
      if (activeOverlays.length !== arOverlays.length) setArOverlays(activeOverlays);

      activeOverlays.forEach(overlay => {
        const [ymin, xmin, ymax, xmax] = overlay.box;
        const x = (xmin / 100) * canvas.width;
        const y = (ymin / 100) * canvas.height;
        const w = ((xmax - xmin) / 100) * canvas.width;
        const h = ((ymax - ymin) / 100) * canvas.height;

        ctx.strokeStyle = overlay.color;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 8;
        ctx.shadowColor = overlay.color;
        const L = 15;

        // Sci-fi Brackets
        ctx.beginPath();
        // TL
        ctx.moveTo(x, y + L); ctx.lineTo(x, y); ctx.lineTo(x + L, y);
        // TR
        ctx.moveTo(x + w - L, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + L);
        // BR
        ctx.moveTo(x + w, y + h - L); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - L, y + h);
        // BL
        ctx.moveTo(x + L, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - L);
        ctx.stroke();

        // Label
        ctx.font = 'bold 12px monospace';
        const txt = overlay.label.toUpperCase();
        const metrics = ctx.measureText(txt);
        ctx.fillStyle = overlay.color;
        ctx.fillRect(x, y - 20, metrics.width + 10, 20);
        ctx.fillStyle = '#000';
        ctx.fillText(txt, x + 5, y - 6);
      });
      requestAnimationFrame(renderAR);
    };
    const id = requestAnimationFrame(renderAR);
    return () => cancelAnimationFrame(id);
  }, [arOverlays]);

  // --- Connection Logic ---
  const handleDeviceSelection = async (audioId: string, videoId: string) => {
    setShowDeviceSelector(false);
    activeAudioIdRef.current = audioId;
    activeVideoIdRef.current = videoId;
    isUserDisconnectingRef.current = false;
    await connect(audioId, videoId);
  };

  const connect = async (audioId: string, videoId: string) => {
    // 1. Generate unique attempt ID to handle race conditions
    const attemptId = Date.now();
    connectionAttemptIdRef.current = attemptId;

    if (!process.env.API_KEY) {
      addLog("API Key 缺失", "SYSTEM", "error");
      return;
    }

    setIsConnecting(true);
    // Only log if this isn't a silent reconnect
    if (!isConnected) addLog("正在初始化加密链路...", "SYSTEM");

    // 2. Setup Audio Contexts (Robust creation)
    try {
      if (audioContextRef.current?.state === 'closed') audioContextRef.current = null;
      if (inputContextRef.current?.state === 'closed') inputContextRef.current = null;

      const audioCtx = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE_OUT });
      const inCtx = inputContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE_IN });
      
      // Resume if suspended (common browser behavior)
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      if (inCtx.state === 'suspended') await inCtx.resume();

      audioContextRef.current = audioCtx;
      inputContextRef.current = inCtx;

      // Ensure Analyser exists
      if (!analyserRef.current) {
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyserRef.current = analyser;
        const gain = audioCtx.createGain();
        gain.connect(analyser);
        analyser.connect(audioCtx.destination);
      }

    } catch (e) {
      addLog("音频核心启动失败", "SYSTEM", "error");
      return;
    }

    // 3. Setup Gemini Client
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const memoryContext = MemoryService.getContextString();
    
    // 4. Connect
    try {
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `你是JARVIS。全能AI管家。始终用中文简练回答。视觉识别格式:[OBJECT:name:ymin,xmin,ymax,xmax]。\n记忆:${memoryContext}`,
          tools: [{ functionDeclarations: TOOLS_DECLARATION }],
        },
        callbacks: {
          onopen: async () => {
            if (connectionAttemptIdRef.current !== attemptId) return; // Stale attempt
            
            addLog("系统在线。链路稳定。", "SYSTEM", "success");
            setIsConnected(true);
            setIsConnecting(false);
            isStreamingRef.current = true;
            nextStartTimeRef.current = 0;

            // Media Streams
            try {
              const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                  deviceId: audioId ? { exact: audioId } : undefined,
                  channelCount: 1,
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                },
                video: {
                  deviceId: videoId ? { exact: videoId } : undefined,
                  width: { ideal: 1280 },
                  height: { ideal: 720 }
                }
              });

              if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play();
              }

              // Audio Input Processing
              const source = inputContextRef.current!.createMediaStreamSource(stream);
              const processor = inputContextRef.current!.createScriptProcessor(4096, 1, 1);
              processor.onaudioprocess = (e) => {
                if (!isStreamingRef.current) return;
                const data = e.inputBuffer.getChannelData(0);
                const blob = createPcmBlob(data);
                sessionPromise.then(s => s.sendRealtimeInput({ media: blob }));
              };
              source.connect(processor);
              processor.connect(inputContextRef.current!.destination);

              // Video Input Processing
              startVideoStreaming(sessionPromise);

            } catch (err) {
              addLog(`传感器挂载失败: ${err}`, "SYSTEM", "error");
              disconnect();
            }
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (connectionAttemptIdRef.current !== attemptId) return;
            
            // Audio
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && audioContextRef.current && analyserRef.current) {
               // We connect temporary sources to the main context's destination via analyser
               // Re-accessing context to be safe
               playAudioResponse(audioData, audioContextRef.current); 
            }

            // AR & Text
            const parts = msg.serverContent?.modelTurn?.parts;
            if (parts) parts.forEach(p => p.text && parseARObjects(p.text));

            // Tool Calls
            if (msg.toolCall) {
              handleToolCalls(msg.toolCall, sessionPromise);
            }
            
            // Interruption
            if (msg.serverContent?.interrupted) {
              addLog("用户打断", "JARVIS", "warning");
              stopAllAudio();
            }
          },
          onclose: (e) => {
             if (connectionAttemptIdRef.current !== attemptId) return;
             console.log("Session closed", e);
             
             if (!isUserDisconnectingRef.current) {
               addLog("链路波动，正在重新校准...", "SYSTEM", "warning");
               // Silent cleanup
               isStreamingRef.current = false; 
               if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
               
               // Retry shortly
               if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
               reconnectTimeoutRef.current = setTimeout(() => {
                 connect(activeAudioIdRef.current, activeVideoIdRef.current);
               }, 1500);
             } else {
               addLog("会话已正常结束。", "SYSTEM", "info");
               cleanup();
             }
          },
          onerror: (err) => {
            console.error(err);
            // Don't disconnect immediately on error, let onclose handle it or retry
          }
        }
      });
      sessionRef.current = sessionPromise;

    } catch (err) {
      addLog(`连接失败: ${err}`, "SYSTEM", "error");
      setIsConnecting(false);
    }
  };

  const startVideoStreaming = (sessionPromise: Promise<any>) => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    frameIntervalRef.current = window.setInterval(() => {
      if (!videoRef.current || !canvasRef.current || !isStreamingRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      if (ctx && videoRef.current.videoWidth > 0) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        ctx.drawImage(videoRef.current, 0, 0);
        canvasRef.current.toBlob(async (blob) => {
          if (blob) {
             const b64 = await blobToBase64(blob);
             sessionPromise.then(s => s.sendRealtimeInput({ media: { data: b64, mimeType: 'image/jpeg' } }));
          }
        }, 'image/jpeg', 0.5);
      }
    }, 1000 / FRAME_RATE);
  };

  const handleToolCalls = async (toolCall: any, sessionPromise: Promise<any>) => {
    for (const fc of toolCall.functionCalls) {
      addLog(`调用协议: ${fc.name}`, "TOOL", "info");
      let result = { result: "OK" };
      if (fc.name === 'setReminder') result = { result: `已设提醒: ${fc.args.task}` };
      if (fc.name === 'toggleSmartHome') result = { result: `${fc.args.device} 已 ${fc.args.action}` };
      if (fc.name === 'saveToLongTermMemory') {
        MemoryService.save(fc.args.key, fc.args.value);
        setMemories(MemoryService.load());
        result = { result: "已归档" };
      }
      sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: result } }));
    }
  };

  const parseARObjects = (text: string) => {
    const regex = /\[OBJECT:(.*?):(\d+),(\d+),(\d+),(\d+)\]/g;
    let match;
    const newOverlays: AROverlayData[] = [];
    while ((match = regex.exec(text)) !== null) {
      newOverlays.push({
        id: Math.random().toString(36),
        label: match[1],
        box: [parseInt(match[2]), parseInt(match[3]), parseInt(match[4]), parseInt(match[5])],
        color: '#22d3ee',
        timestamp: Date.now()
      });
    }
    if (newOverlays.length > 0) setArOverlays(prev => [...prev, ...newOverlays]);
  };

  const playAudioResponse = async (base64Data: string, ctx: AudioContext) => {
    try {
      const decoded = decode(base64Data);
      // Ensure sync
      nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
      const buffer = await decodeAudioData(decoded, ctx, SAMPLE_RATE_OUT, 1);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      // Connect to analyser which is connected to destination
      if (analyserRef.current) source.connect(analyserRef.current);
      else source.connect(ctx.destination);
      
      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += buffer.duration;
      sourcesRef.current.add(source);
      source.onended = () => sourcesRef.current.delete(source);
    } catch (e) {
      console.error(e);
    }
  };

  const stopAllAudio = () => {
    sourcesRef.current.forEach(s => { try{s.stop()}catch(_){} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0; // Reset sync
  };

  const cleanup = () => {
    isStreamingRef.current = false;
    setIsConnected(false);
    setIsConnecting(false);
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    
    if (videoRef.current && videoRef.current.srcObject) {
       (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
       videoRef.current.srcObject = null;
    }
    if (audioContextRef.current) audioContextRef.current.close();
    if (inputContextRef.current) inputContextRef.current.close();
    setArOverlays([]);
  };

  const disconnect = () => {
    isUserDisconnectingRef.current = true;
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    cleanup();
    addLog("系统脱离。", "SYSTEM", "warning");
  };

  const requestDeviceSelection = async () => {
     if (!hasPermission) return;
     try {
       const d = await navigator.mediaDevices.enumerateDevices();
       setAudioDevices(d.filter(x => x.kind === 'audioinput'));
       setVideoDevices(d.filter(x => x.kind === 'videoinput'));
       setShowDeviceSelector(true);
     } catch (e) {
       addLog("设备枚举失败", "SYSTEM", "error");
     }
  };

  // --- Render ---
  return (
    <div className="h-screen w-screen bg-slate-950 text-cyan-500 font-mono flex flex-col overflow-hidden relative">
      <DeviceSelector 
        isOpen={showDeviceSelector} 
        onClose={() => setShowDeviceSelector(false)} 
        onConfirm={handleDeviceSelection}
        audioDevices={audioDevices}
        videoDevices={videoDevices}
      />

      {/* Header */}
      <div className="h-16 shrink-0 border-b border-cyan-900 bg-slate-900/50 flex justify-between items-center px-6 shadow-lg z-10">
        <div>
           <h1 className="text-2xl font-bold tracking-widest text-cyan-400 leading-none">JARVIS <span className="text-xs opacity-50">v2.1</span></h1>
           <span className="text-[10px] text-slate-500 tracking-[0.2em]">NEURAL INTERFACE :: {isConnected ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
        <button
          onClick={isConnected ? disconnect : requestDeviceSelection}
          disabled={isConnecting}
          className={`px-6 py-2 rounded font-bold uppercase tracking-wider transition-all duration-300 ${
            isConnected 
              ? 'bg-red-900/20 text-red-500 border border-red-500 hover:bg-red-900/40' 
              : isConnecting
                ? 'bg-yellow-900/20 text-yellow-400 border border-yellow-500 cursor-wait'
                : 'bg-cyan-900/20 text-cyan-400 border border-cyan-500 hover:bg-cyan-900/40 animate-pulse'
          }`}
        >
          {isConnected ? '断开连接' : isConnecting ? '连接中...' : '初始化系统'}
        </button>
      </div>

      {/* Main Layout: Use min-h-0 and min-w-0 to prevent flex items from overflowing */}
      <div className="flex-1 flex overflow-hidden p-4 gap-4">
        
        {/* Left Column (Video + Vis) - Grows */}
        <div className="flex-1 flex flex-col min-w-0 gap-4">
          {/* Video Container: min-h-0 allows it to shrink instead of pushing page down */}
          <div className="flex-1 relative min-h-0 bg-black rounded-lg border border-slate-800 overflow-hidden group">
             <video 
               ref={videoRef} 
               muted 
               playsInline 
               className="w-full h-full object-contain opacity-90 group-hover:opacity-100 transition-opacity"
             />
             <canvas ref={canvasRef} className="hidden" />
             <canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" />
             
             {/* HUD */}
             <div className="absolute inset-0 pointer-events-none p-4 flex flex-col justify-between z-20">
               <div className="flex justify-between items-start">
                  <span className="text-[10px] bg-black/60 px-2 py-1 border-l border-cyan-500 text-cyan-200">VISION_MOD_01</span>
                  {isConnected && <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-[0_0_10px_red]"></div>}
               </div>
               {!isConnected && !isConnecting && (
                 <div className="self-center text-center">
                    <p className="text-slate-600 text-sm blink mb-2">等待神经连接...</p>
                 </div>
               )}
               <div className="flex justify-between items-end opacity-50">
                  <div className="w-8 h-8 border-l-2 border-b-2 border-cyan-500"></div>
                  <div className="w-8 h-8 border-r-2 border-b-2 border-cyan-500"></div>
               </div>
             </div>
          </div>
          
          {/* Visualizer: Fixed height, doesn't shrink */}
          <div className="h-32 shrink-0">
             <Visualizer analyser={analyserRef.current} isActive={isConnected} />
          </div>
        </div>

        {/* Right Column (Logs + Mem) - Fixed Width */}
        <div className="w-80 flex flex-col min-w-0 gap-4 shrink-0">
           {/* Logs: flex-1 to take available height, min-h-0 to scroll internally */}
           <div className="flex-1 flex flex-col min-h-0 bg-slate-900/30 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] uppercase border-b border-slate-800 pb-2 mb-2 text-slate-500 flex justify-between">
                <span>System Logs</span>
                <span>CMD_OUT</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 font-mono text-xs pr-1 scrollbar-thin">
                {logs.map(log => (
                  <div key={log.id} className="flex gap-2 leading-relaxed">
                     <span className="text-slate-600 shrink-0">[{log.timestamp.split(':').slice(0,2).join(':')}]</span>
                     <div className="break-words">
                        <span className={`font-bold mr-1 ${log.source==='JARVIS'?'text-cyan-400':log.source==='USER'?'text-white':log.source==='TOOL'?'text-yellow-400':'text-slate-500'}`}>{log.source}:</span>
                        <span className={log.type==='error'?'text-red-400':log.type==='warning'?'text-orange-400':log.type==='success'?'text-green-400':'text-slate-300'}>{log.message}</span>
                     </div>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
           </div>

           {/* Memory: Fixed height or ratio */}
           <div className="h-48 shrink-0 flex flex-col bg-slate-900/30 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] uppercase border-b border-slate-800 pb-2 mb-2 text-slate-500 flex justify-between">
                <span>LTM Core</span>
                <span className="text-cyan-600">{memories.length} OBJ</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
                 {memories.map(m => (
                   <div key={m.key} className="text-xs bg-slate-800/40 p-2 rounded border-l border-cyan-800/50">
                      <div className="text-cyan-300 font-bold mb-0.5">{m.key}</div>
                      <div className="text-slate-400 leading-tight">{m.value}</div>
                   </div>
                 ))}
                 {memories.length === 0 && <div className="text-center text-slate-700 text-xs mt-4">无数据</div>}
              </div>
           </div>
        </div>

      </div>
    </div>
  );
}