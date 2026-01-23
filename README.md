# Stellar Card Auth Risk Simulator

Single-page React + TypeScript app that models “card auth then on-chain settle” risk for a self-custody debit card backed by Stellar.

## Features
- Event-driven discrete simulation with deterministic PRNG and seed control.
- Two issuer modes: wait for on-chain confirmation or respond quickly using off-chain holds.
- Stochastic user purchase activity (Poisson + optional burstiness).
- Network, issuer, and Stellar latency modeled via lognormal/gamma distributions.
- Settlement retries, inclusion probability, and outage toggles.
- Exposure metrics, time series, and histograms.

## Quickstart
```bash
npm install
npm run dev
```

## Tests
```bash
npm test
```

## Notes
- Default presets reflect ~6s Stellar close, 5s Europe auth timeout, ~500ms combined network+issuer latency with long tail.
- All logic runs client-side. The simulation engine is separate from the UI and runs in a Web Worker.
