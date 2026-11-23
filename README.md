# Eye-llusion

Eye-llusion is a Preact single-page app for creating and viewing magic-eye style images
(autostereograms). It runs entirely in the browser and is hosted as a static site on
GitHub Pages. Use `npm run dev` to start the dev server, `npm run build` to type-check and
build into `dist/`, `npm run preview` to serve that build, `npm test` to run the unit
tests, `npm run test:browser` to run the Playwright tests against the production build
(install the browsers first with `npx playwright install --with-deps chromium firefox webkit`),
`npm run test:perf` to run the frame-timing tests one file at a time, `npm run check` to
lint, check formatting and report unused exports, and `npm run fmt` to format the code.

`e2e/screenshots.spec.ts` compares the app's chrome, with the generated pictures hidden and
the text in a bundled font, against the images in `e2e/screenshots.spec.ts-snapshots/`, in
desktop Chromium only. After an intended change to the UI, refresh them with
`npx playwright test e2e/screenshots.spec.ts --project=desktop-chromium --update-snapshots`,
look over the new images, and commit them with the change. When the check fails in CI, the
expected, actual and diff images are in the `playwright-results` artifact.
