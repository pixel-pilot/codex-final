# Deployment Notes

## Vercel Production Builds

- Vercel executes `npm run build` during production deployments.
- The project must use the stable Next.js builder; forcing Turbopack causes the build to fail with the message `Turbopack production build is not supported`.
- The `build` script in `package.json` intentionally omits the `--turbopack` flag so that Vercel runs the supported Rust compiler pipeline.
- Local development can continue to leverage Turbopack through `npm run dev` without affecting production builds.
