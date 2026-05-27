---
title: "How Dell Is Beating Supermicro"
date: "2024-05-30T07:25:13.161Z"
url: "https://newsletter.semianalysis.com/p/how-dell-is-beating-supermicro"
author: "Dylan Patel"
description: "Enterprises, Sovereign AI, CoreWeave, Tesla, x.AI, AI Neocloud economics + orders"
---

At Nvidia’s GTC 2024, Jensen went to Dell’s booth and chanted Dell over and over. Jensen even called out Michael Dell in the audience on stage during his keynote speech. Nvidia is clearly excited about Dell’s prospects as an AI server company, but why?

Dell was extremely late to AI servers. In the previous generation A100, they only offered the low volume low end 4xA100 servers (Redstone) geared towards the significantly smaller HPC market. Furthermore, in HPC, Dell only has 7% market share of [publicly disclosed systems](https://www.top500.org/statistics/list/) whereas their chief competitors Lenovo and HPE have 32.6% and 22.4% respectively. Dell didn’t even offer an 8xA100 HGX server (Delta) which is what everyone working on AI used. This includes firms like OpenAI, who used [8xA100 Delta to train and inference GPT-3.5 and GPT-4.](https://www.semianalysis.com/p/gpt-4-architecture-infrastructure)

![](z-images/4c7e33c72c0722150e422e27cadbcba6.webp)

Source: Nvidia, SemiAnalysis

Dell was also late to designing and shipping 8xH100 HGX servers. All this resulted in Dell being the lowest priority partner for Nvidia, but now, Dell the sleeping giant, has finally woken up and they are arguably Nvidia’s highest priority OEM.

The market for Nvidia servers can generally be broken out into OEM’s (Dell, Supermicro, HPE, Lenovo, etc) and ODM’s (Quanta, FII, Inventec, Wistron, Wiywynn, ZT Systems, etc). Hyperscalers tend to buy from ODMs who make ~2% to ~3% margins from building server. The hyperscalers do this because they require a significantly lower-level service relative to other firms.

On the other hand, there are significant buyers in the form of [enterprises](https://www.semianalysis.com/p/accelerator-model), [sovereign AI plays](https://www.semianalysis.com/p/accelerator-model), and [over 15 AI Neoclouds](https://www.semianalysis.com/p/gpu-cloud-economics-explained-the) that require OEM’s. Basically, all of last year and much of the beginning of this year, Supermicro was the sole source for many of these buyers.

**This has changed.**

In this bucket of non-hyperscale customers, Dell is [gaining share at many other Neoclouds, enterprises, and sovereign AI plays](https://www.semianalysis.com/p/accelerator-model). Dell specifically has gained sockets at CoreWeave, Tesla, and x.ai, [the three largest buyers of GPUs that utilize the OEM supply chain instead of ODM direct](https://www.semianalysis.com/p/accelerator-model).

The common narrative that is parroted is that Dell is just getting preferential treatment via Nvidia allocations… After all, he who controls the ~~spice controls the universe~~ Nvidia GPU allocation is able to sell them right? That line of thinking is incorrect. If you want a GPU server, you can buy them from Dell or Supermicro and get them delivered in Q3. Lead times are compressing. Allocations and the tightness of the GPU supply chain is not why Dell is gaining share.

The real reason for the change for preferred OEM partner is far more interesting. We will explain how Dell is beating Supermicro, GPU Neocloud economics, and the capability for these Neoclouds to keep growing and investing below.
