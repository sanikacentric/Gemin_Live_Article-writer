import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isActive: boolean;
  volume: number; // 0 to 1
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, volume }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let bars = Array(20).fill(0);
    
    const render = () => {
      if (!isActive) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const width = canvas.width;
      const height = canvas.height;
      const barWidth = width / bars.length;

      // Update bars based on current volume with some randomness for organic feel
      bars = bars.map((prev, i) => {
        // Center bars are taller
        const centerFactor = 1 - Math.abs(i - bars.length / 2) / (bars.length / 2);
        const target = volume * height * centerFactor * (0.8 + Math.random() * 0.4);
        // Smooth transition
        return prev + (target - prev) * 0.2;
      });

      bars.forEach((h, i) => {
        const x = i * barWidth;
        const y = (height - h) / 2;
        
        const gradient = ctx.createLinearGradient(0, y, 0, y + h);
        gradient.addColorStop(0, '#22d3ee'); // cyan-400
        gradient.addColorStop(1, '#818cf8'); // indigo-400
        
        ctx.fillStyle = gradient;
        // Rounded caps look
        ctx.beginPath();
        ctx.roundRect(x + 2, y, barWidth - 4, h, 4);
        ctx.fill();
      });

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isActive, volume]);

  return (
    <canvas 
      ref={canvasRef} 
      width={300} 
      height={100} 
      className="w-full max-w-md h-24"
    />
  );
};

export default Visualizer;