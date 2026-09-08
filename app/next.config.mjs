/** @type {import('next').NextConfig} */
export default {
  // The usc-sdk is CJS and pulls in ethers; keep it server-side only.
  serverExternalPackages: ["@gluwa/usc-sdk"],
};
