export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-deep-space">
      <div className="w-96">
        <div className="relative h-1 bg-panel-border/30 rounded-full overflow-hidden">
          <div className="absolute top-0 left-0 h-full w-1/3 bg-gradient-to-r from-reactor-core to-reactor-glow rounded-full animate-pulse" />
        </div>
        <div className="mt-4 text-center">
          <span className="font-orbitron text-2xl text-reactor-core">Loading...</span>
        </div>
      </div>
    </div>
  );
}
