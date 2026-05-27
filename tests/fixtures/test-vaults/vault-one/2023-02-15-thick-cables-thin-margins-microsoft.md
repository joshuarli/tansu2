---
title: "Thick Cables, Thin Margins – Microsoft, Amazon, and Google Demand Overstated By $CRDO Credo"
date: "2023-02-15T07:00:06.342Z"
url: "https://newsletter.semianalysis.com/p/thick-cables-thin-margins-microsoft"
author: "Dylan Patel"
description: "Future Demand Booming But Active Electrical Cables Are Not The Salvation"
---

Faster networking speeds have come like clockwork every ~3 years in the datacenter, but scaling is starting to hit some difficulties, especially due to the voracious demand for AI and large language models. The cost of networking is scaling exponentially faster than the cost of CPUs or memory, which has led to a ballooning in datacenter costs. This presents a fundamental problem that requires immediate attention. Vendors such as Nvidia, Intel, AMD, and Broadcom are tackling this from the standpoint of NICs and Switches, but those aren’t the only solution spaces.

One of the biggest issues that datacenter architects are facing is with cables. Each networking generation from 8x25G to 4x50G to 4x100G is causing problems with passive direct attached copper (DAC) cables. As data transfer speeds increase, the cables are becoming wider and larger, containing more copper. Furthermore, these cables are becoming less reliable, and error rates are climbing. Copper is starting to run out of steam, and it is becoming more and more challenging to use.

Moving to a different form of cabling is necessary to address this issue. The obvious choice is optical fiber. The biggest challenge is that optical transceivers are far too expensive. Optical will continue to be used heavily for connecting various server racks together, but connecting servers to the switch in a rack becomes cost prohibitive. We will be discussing optical DSP, cost, and bandwidth scaling at OFC San Diego in a couple of weeks if anyone is interested in meeting the team.

Today we will discuss the solution, active electrical cables (AEC), and their future use by Amazon, Microsoft, and Google. Furthermore, we will cover the competitive landscape of AEC and ACC products as well as the firms in the space, including Credo ( [CRDO 0.00%↑](https://substack.com/search/%24CRDO)), Astera Labs, Marvell ([MRVL 0.00%↑](https://substack.com/search/%24MRVL)), Broadcom ( [AVGO 0.00%↑](https://substack.com/search/%24AVGO)), Maxlinear ([MXL 0.00%↑](https://substack.com/search/%24MXL)), Point2, Spectra7, Macom ([MTSI 0.00%↑](https://substack.com/search/%24MTSI)), Semtech ([SMTC 0.00%↑](https://substack.com/search/%24SMTC)), and Alphawave Semi (£AWE.L). Lastly, we will discuss the SerDes IP used by these players.

![](z-images/47c73028bfcd52a197bd54e6a24f9b3d.webp)

To further demonstrate the issue facing passive copper, imagine an [Nvidia HGX A100 server deployed by Microsoft for use by OpenAI to train large language models](https://www.semianalysis.com/p/the-ai-brick-wall-a-practical-limit). These contain 8 200G or 400G networking interface cards in a 4U server enclosure. As many as 8 of these servers are placed in a single rack, depending on rack power/cooling architecture, and connected to 1 or more networking switches. The cabling density is so high in the rack itself that it can be challenging to use passive copper simply due to cable thickness. This necessitates longer, more cluttered cable runs, leading to signal weakening, worse cooling, and increasing error transmission unless exceptional care is given to the design.

![](z-images/0f9b083eeea55c5a4488208846bb3f80.webp)

Furthermore, similar issues could be faced even in standard CPU compute servers. When looking forward to the [AMD Genoa-based servers with 400G NICs](https://www.semianalysis.com/p/amd-genoa-detailed-architecture-makes) installed at Google, Microsoft, and Amazon, the same problem could crop up if the density of servers is high. For now, passive direct attached copper (DAC) still works outside extremely high-density plays, even for 4x100G. Some mitigation strategies include moving the top-of-rack (TOR) switch to the middle, dramatically reducing the average cable length, and enabling moving back to a more reasonable gauge DAC.

Andy Bechtolsheim, the founder of Sun and Arista Networks, always says that passive copper will always last one more generation, and it continues to do so. This applies to the 200G and 400G generation for the most part.

Even with this mitigation, there are other reasons to use AEC over DAC. Reliability is a crucial metric. In the current server rack architecture, a single TOR switch connects every server in a rack to the broader network. There is a single point of failure. According to this joint presentation by Microsoft and Credo, 2% of these to switches fail within the first three months.

![](z-images/9ff95d034f8203ae74dc66e4ae431fe1.webp)

If there is a failure in the TOR switch, then every server in that rack is now taken offline. SemiAnalysis believes [Amazon uses 32 1U Graviton 3 servers in a single rack](https://www.semianalysis.com/p/amazon-graviton-3-uses-chiplets-and). Each of these 32 servers contains 3 CPUs with 64 cores each. Each server shares a single NIC, which hooks into the TOR switch. This single point of failure at the TOR means that any failure brings down as many as 6,144 customers using m7g.medium or c7g.medium instances.

There is some innovation happening to solve this problem. Dual ToR, Y cables, and X cables are all being developed to enable redundancy options for the NIC, TOR, or both.

![](z-images/798705e77f8ae6ad52207b9cdc9aebdf.webp)

Now that we have the technology covered let’s talk about the specific uses of AEC in off-the-shelf AI hardware, custom AI hardware, and general purpose compute at 8x25G, 4x50G, and 4x100G by Amazon, Microsoft, and Google. We can also discuss the sourcing strategy. Furthermore, we will discuss NIC/Switch choices at these three firms. Lastly, we will also discuss the AEC product timing and SerDes IP licensing from Marvell, Astera Labs, and Alphawave. We can also share AEC and Optical ASPs for 4x25G, 4x50G, and 4x100G.

Credo was the first to market with AEC, and their primary customer is Microsoft at 4x50G within AI applications, including the aforementioned Nvidia HGX A100 example. This includes the [ND A100 v4-series instances](https://learn.microsoft.com/en-us/azure/virtual-machines/nda100-v4-series), which are the workhorse for most training workloads. InfiniBand switches supposedly had lower reliability at the time, which is what the Microsoft Credo example pointed out. This was the main driver for Credo’s dual TOR technology.

In this case, Microsoft chose AEC strictly for this reliability advantage in InfiniBand deployments. The benefits of AEC cable run distances were irrelevant as Microsoft could also implement DAC instead of AEC at <3m runs without a perceivable increase in error rates. Similarly, AEC has no cost advantage over optical at hyperscale volumes of 4x50G, with both having similar ASPs. The dual TOR AEC has a higher ASP than standard 1 to 1 optics. Add on the 2 <sup>nd</sup> switch, and this is very costly on an infrastructure basis.

Edit: [CRDO 0.00%↑](https://substack.com/search/%24CRDO) is down nearly 50% today from $19.36 to $10.30 related to the events we describe here and in the rest of the report. Microsoft only implemented AEC at low volumes. As InfiniBand switch reliability has come up, they phased this technology out. Microsoft has moved back to the cheaper options of DAC and multi-mode optics in this AI application.

Oddly, Credo is only alerting investors now as the sell side happily went crazy with their speculation on business. Some sell-side and buy-side even said Credo would sell 500,000 AEC this year at a $200 ASP to Microsoft alone. That’s not happening. Instead,
