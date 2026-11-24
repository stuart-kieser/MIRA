interface BrandProps {
  style?: string;
}

export function Brand({ style = "simple" }: BrandProps) {
  let logo = "";

  switch (style) {
    case "simple":
      logo = "/AppLogo.png";
      break;
    case "block":
      logo = "/AppBanner.png";
      break;
    case "banner":
      logo = "/AppBannerLogo.png";
  }

  return (
    <div className="brand">
      <img src={logo} className={style === "simple" ? "brand-logo brand-wordmark" : "brand-logo"} alt="Mira" />
    </div>
  );
}
