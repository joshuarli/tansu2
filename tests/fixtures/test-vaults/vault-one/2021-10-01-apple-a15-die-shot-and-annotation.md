---
title: "Apple A15 Die Shot and Annotation - IP Block Area Analysis"
date: "2021-10-01T00:05:00.000Z"
url: "https://newsletter.semianalysis.com/p/apple-a15-die-shot-and-annotation"
author: "Dylan Patel"
description: "TechInsights released a die shot of the A15 and with the help of SkyJuice’s, we are analyzing it today."
---

TechInsights released a die shot of the A15 and with the help of SkyJuice’s, we are analyzing it today. The total die has increased significantly in size to 107.7mm^2 from 87.76mm^2 and from 11.8B transistors to 15B transistors. The initial Apple claims were [not that impressive. The most disappointing aspect was the lack of CPU gains.](https://semianalysis.com/apple-cpu-gains-grind-to-a-halt-and-the-future-looks-dim-as-the-cpu-engineer-exodus-to-nuvia-and-rivos-impact-starts-to-bleed-in/) Despite this, there are still many changes this generation. [AnandTech](https://www.anandtech.com/show/16983/the-apple-a15-soc-performance-review-faster-more-efficient) has done their preliminary review on the A15 SOC and combined with the die analysis many interesting details can be gleaned.

![](z-images/84ae25981dc31cf380521639a9b03a50.webp)

The first detail that can be confirmed is that the process density is unchanged. The individual SRAM cells are unchanged and LPDDR4x PHYs are also identical in size. This likely confirms that Apple is using N5P and not the N4 process like some speculated.

![](z-images/8251d4adc51fcfebdd28b445a73593b8.webp)

Total die area is up 22.8%, but various IP blocks differ. The shared level cache is the single largest contributor. The ISP looks highly revised as well, but we do not have measurements here. The NPU remains 16 Cores, but the cores and shared logic were changed architecturally to bring about a sizable performance increase. Despite the lack of IPC gains in the big core, the big core still has some changes.

![](z-images/34717273f4cb1396be335349f3902ac4.webp)

Despite being the smallest IPC gain for Apple ever, the core is clearly rearchitected. The two largest changes are related to the MMU and caches. The layout is significantly different and there is a 15.26% increase in the Core+L1 area. [Anandtech](https://www.anandtech.com/show/16983/the-apple-a15-soc-performance-review-faster-more-efficient) discovered an interesting change to the L1 cache.

> On the performance cores I’m also seeing some changes in the L1 speeds as it seems to be able to make 1-cycle accesses to cache lines, as long as they’re in the same page, the same type of access on the A14 takes 3 cycles.

![](z-images/e9612aa949cb2a9700bd9a530d571ced.webp)

The shared L2 cache was increased to 12MB from 8MB. This is identical to the M1 despite having half the cores. [Anandtech](https://www.anandtech.com/show/16983/the-apple-a15-soc-performance-review-faster-more-efficient) found that it the access latency has increased to 18 cycles from 16. The tradeoff on size versus latency seems to be well worth it. The shared L2 cache block has grown 52% in size versus the A14.

![](z-images/72bbbb3413cbe6dca4f25398f8bba87b.webp)

The little core, Blizzard, has grown 18.6% in size, but the performance increase is 23%. The L2 core remains 4MB, but has increased slightly by 2.5%. The Apple blizzard core is now performing on par with the big A76 core in 2 year old Android SOCs.

![](z-images/b655bd414d3472fc3044fa8a6eda5e30.webp)

Apple really focused on GPU for the A15. Apple released [this video](https://developer.apple.com/videos/play/tech-talks/10876) which details some of the architectural changes. Among them is doubling the FP32 ALUs which was in the M1 GPU core. Apple also introduced lossy renderable textures that save memory storage & bandwidth, support for sparse depth & stencil textures and a new SIMD shuffle and fill instructions. Despite all of these changes, the core has only increased 4.4% in size.

![](z-images/0bc493149263cccaf6419d6a61b3fe3a.webp)

The entire GPU is up 30% in size. This is mostly due to the 5th GPU core and changes to the shared logic. Even when the 5th core is disabled, there is still a sizable performance increase. The new larger GPU achieves a huge performance increase despite no increase in memory bandwidth. Apple is pursing a similar strategy to AMD’s Infinity Cache it seems.

![](z-images/41c391d42ce6293001f043d74f9bd442.webp)

The single largest area contributor is the system cache. It has doubled from 16MB to 32MB. This helps keep the various IP blocks of the A15 fed. This article was just a short summary of SkyJuice die analysis. What else did you folks notice about the die shot?

*This article was originally published on [SemiAnalysis](https://semianalysis.com/china-has-built-the-worlds-most-expensive-silicon-carbide-fab-but-numbers-dont-add-up/) on September 30th 2021.*

*Clients and employees of SemiAnalysis may hold positions in companies referenced in this article*.
