---
title: "Marvell's Next $1B Business Is Security – Hardware Security Modules HSMs"
date: "2022-12-05T14:15:54.234Z"
url: "https://newsletter.semianalysis.com/p/marvells-next-1b-business-is-security"
author: "Dylan Patel"
description: "Cloud based LiquidSecurity HSMs will eat the world"
---

Marvell has multiple significant markets that are often discussed, storage controllers, electro-optical devices, network switching, network processors, and custom silicon for hyperscalers. One market for Marvell that isn’t discussed much is hardware security modules, yet it is likely to be a $1B business for Marvell.

![](z-images/9195a878f0b0c7113e36d13d52100244.webp)

Hardware security modules (HSM), as the name implies, are independent hardware devices that are used to protect against unauthorized access to materials. HSMs are designed to securely manage the lifecycle of cryptographic keys used in signing, encryption, and authentication. The cryptography lifecycle has 6 key tasks.

- Provisioning – The HSM creates keys. These should be completely random, or else it will be possible to analyze the behavior of the hardware, predict keys, and compromise the secured data.
- Backup and storage – A copy of the keys should be made and stored in case the key is compromised or lost. They must also be stored securely and be resistant to physical tampering.
- Deployment – The HSM deploys the keys to only authorized devices and allows it to use that key to access the data it is authorized to access.
- Management – The keys must be monitored and rotated as they expire. Devices that are compromised must have their access revoked.
- Archiving – Decommissioned keys are put into offline, long-term storage so that they can be retrieved for already encrypted data in cold storage.
- Disposal – Keys are securely and permanently destroyed and should be verified as destroyed and not stored anywhere else.

Traditional HSMs cost tens of thousands of dollars and are deployed mainly on-premises. They are not well geared for the cloud and large multi-site on-premises deployments. They are 1U boxes that are typically self-managed by enterprises.

![](z-images/75bde7c4affd8ae969d5952025fdc431.webp)

Cloud computing complicates securing sensitive data. The HSM systems must be integrated into the cloud’s network. Cloud vendors initially provided their own key management services, but these weren’t usable across hybrid cloud and multi-cloud environments. Enterprises with these hybrid and multi-cloud infrastructures had to deal with the complexities of multiple key management tools, including the potential security holes that could be created. If they continued using their on-premises HSM, their infrastructure would not be resilient to outages.

The clouds started to come out with key management as a service. The HSM is a virtual appliance hosted on a cloud computing platform and accessed over the internet, with cached HSM throughout the network. This can provide the same level of security as a physical HSM, but with the added convenience and flexibility of being delivered as a cloud service. This is very cost-effective due to enterprises not having to purchase their own expensive infrastructure or support it with skilled personnel. With these service-based systems, encryption key management functions can take place at a digital edge node, minimizing latency and improving application performance.

![](z-images/aedac2940bcebf0f3328e862c26eeba5.webp)

This is where Marvell comes in with their LiquidSecurity lineup. They provide the HSM hardware as a PCIe card that can replace traditional 1U HSM modules at significantly lower capital and operating costs. With Marvell’s solution, deployed by cloud providers, enterprises can get HSM as a service per hour (~$2) or per transaction (10,000 updates for ~3 cents, depending on the cloud.). The cost is lower than the traditional HSM infrastructure, even for many large enterprises. These large enterprises with their own infrastructure can also deploy the Marvell LiquidSecurity PCIe cards.

The LiquidSecurity line is very successful, with sales to 6 of the 10 largest cloud service providers, the top 5 social media sites, most top-ranked SAAS companies, and most leading OEMs and ISVs.

![](z-images/5327e472079b3704274f3615d54c1f3a.webp)

Marvell recently launched LiquidSecurity 2, which brings some very interesting improvements. From a semiconductor perspective, it is exciting as it shares much of its architecture with Marvell’s Octeon DPUs networking add-in cards and Octeon Fusion 5G network processors.

This keeps Marvell far ahead of other hardware providers. For reference, the HSM market was ~$700M annually last year, but the cloud HSM content was ~$120M. The HSM market in 2027 should comfortably exceed $1B, and the cloud HSM content should be closer to $600M. Marvell dominates the cloud approach, and the non-cloud approach likely moves towards a private-cloud approach. This could mean that Marvell’s HSM business could be as much as $1B by the end of the decade.

It's worth noting that this shouldn’t be confused with the local HSM’s that exist on many server boards. This is strictly about HSM’s that serve many servers. As an aside, there is a cool startup in this space, Axiado, who are integrating management NIC, RoT, local HSM cache, and BMC into one chip that goes into every server.

We also want to briefly discuss the volume and/or market share loss in storage controllers, electro-optical business (DSP, TIA, drivers), and cloud custom silicon business.
