import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // yahoo-finance2 usa API Node (fs per la cache del crumb): va tenuto fuori dal bundle.
  serverExternalPackages: ["yahoo-finance2"],
};

export default nextConfig;
