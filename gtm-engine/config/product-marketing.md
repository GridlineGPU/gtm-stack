# Gridline: product marketing context

Every agent in this repo reads this file first. Swap it out to run the engine for another company.

## Product
Gridline is the OpenRouter for GPUs: one interface for aggregating and routing GPU capacity across providers. EF F26. Founder: Chinmay.

## Two sides of the market
- Supply: GPU clouds and neoclouds with idle or reservable capacity (see ../output, 106 providers).
- Demand: B2B teams serving their own or open models in the 7B to 32B class, mostly voice and document AI (see ../output-demand, 94 companies).

## Where Gridline sits
Closest to the aggregators in the "spot venues, auctions and aggregators" box: Mithril, Shadeform, Hydra Host, NVIDIA DGX Cloud Lepton. Venues and auctions (SF Compute, Compute Exchange, Computable) compete for the same buyer with a different mechanism. The spot layer (RunPod, Vast.ai, TensorDock, Salad, Clore) is supply.

Index providers (Silicon Data, Ornn, Compute Desk) already publish GPU price indices that CME and ICE futures settle on. A Gridline value asset should cover routing and availability by workload, which they don't publish, or partner with one of them.

## Watch list
OpenRouter agreed to be acquired by Stripe in August 2026. It routes tokens, not GPU-hours, but Stripe described the deal as AI expense management and could move down the stack.

## Role hypotheses
Roles in config/company.json are hypotheses until the founder confirms them in the app.
