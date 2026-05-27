---
title: "Apple’s A14 Packs 134 Million Transistors/mm², but Falls Short of TSMC’s Density Claims"
date: "2020-10-27T17:53:00.000Z"
url: "https://newsletter.semianalysis.com/p/apples-a14-packs-134-million-transistorsmm"
author: "Dylan Patel"
description: "Our friends over at ICmasters have delved into the package of the Apple A14 Bionic."
---

![](z-images/8b51bb8ca9163bc04f26384bfc5d4557.webp)

Our friends over at ICmasters have delved into the package of the Apple A14 Bionic. The die size has been unmasked, and it stands in at 88mm2. Despite cramming in 11.8 billion transistors, the die size is incredibly small thanks to utilization of TSMC’s 5nm process node.

![](z-images/5dfaf5dca484144b3358380f0106fe1c.webp)

The march of progress is not all rosy. Apple’s chips have historically achieved 90%+ of the process node’s theoretical density in their processors. This generation stands out by missing that mark by a large amount. A14 comes in at a cool 78% effective transistor density when compared to theoretical density. Despite TSMC claiming a 1.8x shrink for N5, Apple only achieves a 1.49x shrink.

![](z-images/11321ecfbd922c430859ada38f72b0ea.webp)

This is not due to a failure of TSMC or Apple. These companies are clear leaders for the manufacturing and design of semiconductors respectively. Instead, this failure to convert theoretical to effective density stems from the slow death of SRAM scaling. SRAM is extensively used throughout a processor from registers to caches. Geoffrey Yeap of TSMC claims that the typical mobile SoC which consists of 60% logic, 30% SRAM, and 10% analog/IO.

![](z-images/925459be90c2ded7b1d8716aa09b8f58.webp)

TSMC’s N5 node diverges from prior shrinks by showing signs of slowing SRAM scaling. Despite being a full shrink with logic, the SRAM is a 1.35x shrink. This figure is overstated as it will end up being even lower once other the other assist circuitry is accounted for. Hence TSMC’s guidance of chip area reduction at 35%-40% with N5. SemiAnalysis expects this to be a trend that will persist with new nodes. TSMC and Samsung are already demonstrating 3D stacked SRAM which will help alleviate the issue of density.

![](z-images/7b69aa682599dc50d68aa79036e6dd7a.webp)

3D Stacking is not the silver bullet. Cost scaling has begun slowing dramatically. With TSMC N5 wafer pricing in the ~$17k range, it is clear cost per transistor has not fallen. Even if SRAM scaling kept up, the cost per transistor would still have remained flat from N7 to N5.

![](z-images/be78a557764f52956e82d299475e03f7.webp)

_This article was originally published on [SemiAnalysis](https://semianalysis.com/apples-a14-packs-134-million-transistors-mm2-but-falls-far-short-of-tsmcs-density-claims/) on October 27nd 2020_.

_Clients and employees of SemiAnalysis may hold positions in companies referenced in this article_.
