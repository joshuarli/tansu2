---
title: "Intel’s Trojan Horse into the Foundry Business | Co-packaged Silicon Photonics is Intel’s Path Forward for IDM 2.0"
date: "2021-06-11T13:34:01.049Z"
url: "https://newsletter.semianalysis.com/p/intels-trojan-horse-into-the-foundry"
author: "Dylan Patel"
description: "Pat Gelsinger’s first move as the new CEO was to do a complete 180 on Intel’s historic business model and enter the era of IDM 2.0."
---

Pat Gelsinger’s first move as the new CEO was to do a complete 180 on Intel’s historic business model and enter the era of IDM 2.0. He wants to open up Intel’s fabs to external designs and license its IP to these clients that utilize Intel’s fabs for manufacturing. Intel has a very tough proposition for convincing clients to come manufacture. They have had numerous delays for process nodes from a minor silent delay on 14nm to multi-year delays for 10nm and 7nm. Furthermore, in the past they had sunk at least 3 major in-house silicon efforts due to failures at the fabs, LG, Nokia, and Ericsson.

Intel has quickly attempted position themselves as another source to the automotive world. Furthermore, they have petitioned that they are the only secure leading-edge foundry for the US defense industry. These would be important wins, but at the end of the day they are not exceptionally large markets. Intel must win over other merchant silicon vendors. They must win over the trillion-dollar tech firms. This will be a near impossible sell.

![](z-images/df0bfdf4553c55650cbce94c8f373c4a.webp)

SemiAnalysis believes that Intel will lag 2 years behind TSMC, until at least 2025, in bleeding edge semiconductor manufacturing process technology. This gap could potentially be argued as larger, and there is a high possibility this gap could be extended beyond 2025.

Leading edge semiconductors are a partially a question of scale. One cannot fund the next, more complex process technology unless you have a sizable business to fund it. Intel has continuously lost total share of leading-edge semiconductors to TSMC and Samsung over the last decade as they fumbled the smartphone business and now, as they cede PC and server market share. The losses have accelerated rapidly in the last few years with Apple, Nvidia, AMD, Apple, Amazon, and other in-house silicon efforts. If they continue to lose share in the long run, they may lose the ability to bankroll future process development. One of the core purposes of IDM 2.0 is to reverse this trend.

In the foundry business, not only are they behind in technology, but they are also hindered heavily by cost structure due to the economic, educational, and political systems in locations where Intel operates. Despite this, the newly unveiled IDM 2.0 can still a potential homerun.

![](z-images/93dbddc37c0e89ccdef9023cc51b1f9c.webp)

Intel has a vast suite of IP and manufacturing capabilities that could win over clients. [Intel is even considering purchasing Si Five, a RISC V core company, to bolster IP offered by their foundry service.](https://www.bloomberg.com/news/articles/2021-06-10/chipmaker-sifive-is-said-to-draw-intel-takeover-interest) Rationally, many of these clients still see Intel as a competitor. TSMC champions that they do not compete with any of their customers. It may seem like a no brainer for the competition to continue to flock towards TSMC as they have been over the last decade, but TSMC is missing an extremely critical technology for the future of semiconductor manufacturing and design.

![](z-images/4fe6b17444d05968ab1905f3f872bc03.webp)

Intel manufactures silicon photonics at the largest scale in the world. They lead in market share for manufacturing optical networking transceivers. They are also going to be a leader in Lidar, another emerging application for silicon photonics. TSMC operates in manufacturing of both optical transceivers, but their technology is considered to be behind Intel’s.

![](z-images/20b58c2a99995cd68484cc18df00a284.webp)

The extreme volume of Intel’s solution to the silicon photonics problem is already reaping benefits. Whereas most other competitors use a less integrated process restoring to a custom flow with many disparate components integrated together by hand at a lower volumes, Intel’s scale and the integrated nature of their solution has led to them leading the industry with only 2 failures per 1B hours. This is 2 orders of magnitude better than the competition.

![](z-images/3dba654f248b60ab085fbbc8baf88e5d.webp)

The amount of data being moved and stored is increasing far more rapidly than data processing itself. Intra-datacenter traffic has been growing at 25% a year, with large hyperscalers in the 40%-50% range. As this growth blossoms, the share of total datacenter power consumption that is expended on data transfers and communications is rising rapidly. The rate of growth is unsustainable without a paradigm shift in design.

![](z-images/bc92823cc4f84cb847aa820eb3df9294.webp)

Datacenter switches are continuing to scale because on-chip capabilities are still scaling. The semiconductor industry sees a path forward to a decade of innovation with hundreds of TB/s of on die and package bandwidth. On the other hand, out of package bandwidth is increasing at an alarmingly slow rate. Additionally, researchers see an end to economic scaling with electrical signals carried by copper wire at 200Gb per signal lane. The only viable path forward is optical with silicon photonics.

![](z-images/57e3fd7788d2a54f75e022ff40e2c70b.webp)

Chip designers need to be cognizant of this problem. The venerable industry genius Jim Keller, who is now at TensTorrent, is steaming headlong into this issue. He may be able to design the best compute silicon in the world, but the team will run into a huge IO power problem. Their upcoming processor will contain 16x100Gbe links. This will consume more power than the memory subsystems or compute itself. As they scale into the future, these IO links will continue to grow at a faster rate than the computational elements. Power per bit transferred will not fall too much further with electrical signaling, and networking will hog larger portions of the power budget, blocking performance gains.

![](z-images/dce4cdb1f05d0aa9dfe534c718ce67ec.webp)

Nvidia has agreed this is a major problem for them as well. They are the leaders in the future of silicon, and they know they will need to switch to co-packaged silicon photonics. Nvidia is already demonstrating theoretical research for products with co-packaged silicon photonics. They show that power per bit transferred halves. Furthermore, Nvidia could build much larger scale up AI systems with more GPUs in a coherent network.

![](z-images/ed9e68480fa2d86bb26fb6e9ae380712.webp)

Nvidia shows massive power efficiency gain on the last generation Volta silicon signaling rates. If we apply their research to the current generation Ampere silicon, and scale forward a few generations, compute scaling will be heavily hindered by copper electrical signaling and lead to explosion of power consumed by package IO.

![](z-images/36dccc313168ab2867320c3dc363238f.webp)

Nvidia’s research shows co-packaged photonics operating at only 25Gbps per laser, Intel is already capable of 100Gbps and lower power per bit transferred. Additionally, Intel is demonstrating on chip optical modules are connected through an EMIB style interposer while Nvidia is still researching these on chip signals being sent through an organic package. While Nvidia recognizes the problem, their research is already behind what Intel can manufacture. Furthermore, Nvidia has no way of getting what they demonstrated mass produced.

![](z-images/2817681f25269c4722cabed31c501209.webp)

Co-Packaged Silicon Photonics will come to networking switches first in the 2023-2024 time frame, as this is the most IO intensive workload. Intel argues that the processor of the future will need co-packaged silicon photonics. The future of the industry hinges on breaking the constraints of copper.

![](z-images/2ba32ea3cbd54526e6374a2fe791f772.webp)

Looking forward to industry roadmaps, entire racks of servers compute and IO will be built within a single silicon package. Entire networking switches worth of bandwidth will need to be sent in and out. All processors in the future will need to scale optical IO, not just networking switches.

![](z-images/fb156ed75e96c64453120a48ec52dd6d.webp)

Only Intel has the manufacturing, packaging, and silicon photonics capabilities of solving the data IO problem. While they lag behind in other areas, if they execute on an aggressive roadmap, others will have no choice besides utilizing Intel to package their datacenter silicon. Intel can offer up other IP to clients, but the trojan horse for the various merchant silicon providers and the trillion-dollar tech companies is to move to a semi-custom model with Intel's co-packaged silicon photonics.

![](z-images/dfa4750679972effde7ba74b54aeb26a.webp)

This model would involve deep collaboration with Intel on the design and manufacture of massive systems on packages. If Intel can seize the opportunity by keeping their advantage in high volume, reliable, and efficient silicon photonics, they will continue to find themselves at the heart of every datacenter. While this does not help Intel with any of their problems before 2025, it could become the engine for growth beyond this time frame.

**\*Author’s Note:** A friend asked me to write an article with what I believe is the single largest bull case for Intel. While I am cautious of believing the narrative I have espoused above, if Intel can outexecute others on photonics they will not become an eroded shell. They could even eventually find themselves as the most valuable semiconductor company again. This would be a long and low probability path.\*

_This article was originally published on [SemiAnalysis](https://semianalysis.com/intels-trojan-horse-into-the-foundry-business-co-packaged-silicon-photonics-is-intels-path-forward-for-idm-2-0/) on June 11th 2021_.

_Clients and employees of SemiAnalysis may hold positions in companies referenced in this article_.
