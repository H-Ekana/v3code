export function SplashScreen() {
  return (
    <div className="v3-splash min-h-screen">
      <img
        alt=""
        aria-hidden="true"
        className="v3-splash-art v3-splash-stars"
        src="/v3-splash-stars.svg"
      />
      <img
        alt=""
        aria-hidden="true"
        className="v3-splash-art v3-splash-cloud-layer v3-splash-clouds-mid"
        src="/v3-splash-clouds-midground-v2.webp"
      />
      <img
        alt=""
        aria-hidden="true"
        className="v3-splash-art v3-splash-cloud-layer v3-splash-clouds-foreground v3-splash-clouds-foreground-left"
        src="/v3-splash-clouds-foreground-v2.webp"
      />
      <img
        alt=""
        aria-hidden="true"
        className="v3-splash-art v3-splash-cloud-layer v3-splash-clouds-foreground v3-splash-clouds-foreground-center"
        src="/v3-splash-clouds-foreground-v2.webp"
      />
      <img
        alt=""
        aria-hidden="true"
        className="v3-splash-art v3-splash-cloud-layer v3-splash-clouds-foreground v3-splash-clouds-foreground-right"
        src="/v3-splash-clouds-foreground-v2.webp"
      />
      <div className="v3-splash-card" aria-label="V3 Code splash screen">
        <img alt="V3 Code" className="v3-splash-logo" src="/apple-touch-icon.png" />
      </div>
    </div>
  );
}
