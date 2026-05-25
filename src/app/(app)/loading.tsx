export default function AppLoading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="h-3 w-32 bg-neutral-200 rounded mb-3" />
      <div className="h-8 w-72 bg-neutral-200 rounded mb-2" />
      <div className="h-4 w-96 bg-neutral-100 rounded mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 bg-white border border-stroke-soft rounded-lg" />
        ))}
      </div>
    </div>
  );
}
