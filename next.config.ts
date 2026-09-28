import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // One folder with the server and only the modules it uses, for the container.
  output: "standalone",
};

export default nextConfig;
