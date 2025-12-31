import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
}

export const Visualizer: React.FC<VisualizerProps> = ({ analyser, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      if (!isActive) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Draw a dormant "pulse" line
        ctx.beginPath();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
        return;
      }

      analyser.getByteFrequencyData(dataArray);

      ctx.fillStyle = '#020617'; // Match bg
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;

        // Jarvis Cyan Color
        const r = 34;
        const g = 211;
        const b = 238;
        
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [analyser, isActive]);

  return (
    <div className="w-full h-32 border border-slate-800 bg-slate-900/50 rounded-lg overflow-hidden relative">
      <div className="absolute top-2 left-2 text-xs text-cyan-500 font-bold tracking-widest uppercase">
        听觉频谱分析
      </div>
      <canvas 
        ref={canvasRef} 
        width={300} 
        height={128} 
        className="w-full h-full" 
      />
    </div>
  );
};