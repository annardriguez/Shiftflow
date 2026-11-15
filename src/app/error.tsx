"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="empty-state">
      <h1>Let’s get back in flow.</h1>
      <p>
        This view couldn’t load. Your saved workspace is still on your computer.
      </p>
      <button className="btn primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
