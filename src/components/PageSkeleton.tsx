// Lightweight loading skeleton shown instantly during route transitions
// (via each route's loading.tsx Suspense boundary), so navigation feels snappy
// even while the server fetches the profile.
export function PageSkeleton({ title }: { title?: string }) {
  return (
    <div className="min-h-screen pb-24" style={{ background: '#F9F5F0' }}>
      <header className="px-5 pt-14 pb-4">
        {title ? (
          <h1 className="text-2xl font-black" style={{ color: '#2D2D2D' }}>{title}</h1>
        ) : (
          <div className="h-7 w-40 rounded-lg animate-pulse" style={{ background: '#ECE5DC' }} />
        )}
      </header>
      <div className="px-4 flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-3xl animate-pulse"
            style={{ background: '#ECE5DC', height: i === 0 ? 120 : 76 }}
          />
        ))}
      </div>
    </div>
  );
}
