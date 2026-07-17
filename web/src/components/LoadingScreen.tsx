type LoadingScreenProps = {
  message?: string;
};

export function LoadingScreen({ message = 'Loading…' }: LoadingScreenProps) {
  return (
    <div className="grid h-full min-h-[12rem] place-items-center px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <img
          src="/walkcroach-icon.png"
          alt=""
          className="h-12 w-12 rounded-sm opacity-90"
          width={48}
          height={48}
        />
        <p className="text-sm text-mist">{message}</p>
      </div>
    </div>
  );
}
