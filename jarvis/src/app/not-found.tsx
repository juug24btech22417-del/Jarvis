export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-deep-space text-text-primary p-8">
      <h2 className="text-4xl font-orbitron mb-4 text-reactor-core">404</h2>
      <p className="text-text-secondary mb-6 font-rajdhani text-xl">
        Page not found
      </p>
      <a
        href="/"
        className="px-6 py-3 bg-reactor-core text-white font-rajdhani font-semibold rounded hover:bg-reactor-core/80 transition-colors"
      >
        Return Home
      </a>
    </div>
  );
}
