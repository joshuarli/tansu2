---
title: "Caliptra – First Open-Source Silicon Going Into All Datacenter Chips"
date: "2022-10-25T12:38:58.531Z"
url: "https://newsletter.semianalysis.com/p/caliptra-first-open-source-silicon"
author: "Dylan Patel"
description: "Every chip from Microsoft, Google, AMD, and Nvidia"
---

Open-source drives the technology industry. To even read this article, data flowed through many layers of open-source from networking to operating systems to browsers. Despite the prevalence of open-source in production deployments of software, there is practically 0 open-source silicon in production for consumer or datacenter applications.

The lack of open-source silicon will be changing very rapidly due to [Caliptra](https://www.opencompute.org/documents/caliptra-silicon-rot-services-09012022-pdf), the first instance of the open-source revolution finally coming to silicon. While there have been some academic and low-volume attempts at open-source, Caliptra will be implemented in chips from multiple providers and deployed in datacenters around the world.

At the Open Compute Project 2022, Caliptra was jointly announced by Microsoft, Google, AMD. Nvidia also joined the project more recently and will begin contributing to the effort. After having spoken to a few engineers about the project at OCP, it seems clear that Microsoft and Google will make it a requirement for all compute, networking, and memory/storage controller chips supplied to their datacenters to implement a Caliptra-based open-source silicon root of trust.

The impetus of this project seems to be that Microsoft and Google wanted to implement different forms of root of trust within their own and partner silicon. Our understanding is AMD took these requests and wanted to align their partners together. All 3 firms joined together to create an open standard like Titan, but with more buy-in and focused open development. Google and Microsoft are targeting Caliptra implementation in their own silicon in 2024, and AMD is targeting soon after.

It is vital that this effort gains traction beyond these 4 major companies listed for security as well as bringing the idea of open-source RTL to more aspects of advanced semiconductors and unlock a whole new era of innovation.

## What is a root of trust?

A root of trust is a block of IP that creates a chain of trust during the boot procedure. It ensures the firmware loaded by the bootloader is signed and trusted. If that firmware is trusted, then it will continue to load other software such as the operating system. Each root of trust has a unique signature that is created during the manufacturing process. The root of trust can protect against supply chain level attacks such as unauthorized chips in servers as well as tampered firmware.

![](z-images/8cefd691fe0a5f36d6adcbdd32640e16.webp)

Currently, Microsoft, Google, HPE, Dell, etc all integrate a separate die that establishes root of trust on a server level, but there still is no standardized device on the chip level. As SoCs get more complex with more functions and [composable server architecture becomes more common](https://semianalysis.substack.com/p/cxl-deep-dive-future-of-composable), security will be more difficult to handle.

![](z-images/d2d0c9f5122e09a905525007ed9de281.webp)

Each processor which exists in the data plane must have a standardized method for detecting, measuring, verifying, and testing the security of that chip and the firmware running on it. The Caliptra project wants to decouple the protection and recovery aspect of a root of trust from the detection aspect of a root of trust. Think of Caliptra as a secure island that then boots the rest of the SoC it is integrated into. By having a root of trust directly integrated into the SoC, it is much harder to fool the bus or extract the cryptographic signature with a firmware or supply chain-based attack.

![](z-images/562af3241b00cd0fd7bf63c27beb09cd.webp)

This split also enables the hardware architecture of Caliptra to be implementable easily by a variety of fabless design companies. There is no need for those designers to add capabilities related to update, fallback, A/B recovery, TPM, and ownership flows. This simplicity also keeps the die area of Caliptra well under 1mm2 on a 7nm class node as per an engineer who works on this product that we spoke with. Below is a block diagram of the hardware block. It is a self-contained island with its own RISC-V core, read-only memory, IO, and crypto subsystem.

![](z-images/0ab89e852c884bd3e3ba97ee4269e6a6.webp)

Caliptra’s open-source status enables it to be highly transparent and guarantees implementation consistency. Limiting the scope to the detection model enables easy implementation and a high degree of reusability across designs.

> It is not a story of differentiation. It is a story of consistency. Caliptra is not a landing pad for vendor “value adds”
> 
> Hemaprabhu Jayanna, AMD Director of Product Security - Architecture & Engineering

![](z-images/4dc4436cd692aed521fcc0d631ed4e84.webp)

There are two pathways for deployment. Regardless of the pathway, Caliptra will own and derive identity, measure and attest blobs, and enforce volatile ownership. In legacy-style server deployments, the legacy SoC BROM is trusted and owns the firmware sequencing. In new deployments, the Caliptra open-source root of trust will own the boot IO, firmware layout, SoC sequencing, resets, and DMA islands.

![](z-images/008711b58d604bbebc491b1fb23c213a.webp)

Proprietary/OEM-signed forked firmware is not allowed.

> Manufacturers get the ability to ensure, on their device, only authentic code can run, and then the owner gets the right that only authorized authentic code can run on that device. Caliptra is not running any proprietary firmware that’s OEM signed or cloud-signed exclusively. Its always got the device manufacturer and it has to be open-source firmware. One of the goals for this route of trust for measurement is to ensure that we have consistency and transparency. We want to avoid fragmentation and forking and pollution of other capabilities into security technologies. Often we see over time, great security technologies getting compromised by other great ideas from management and other things that you can put inside that secure boundary. Then before you know you have this bloat on a security technology and of course it starts to weaken its security posture because it's now doing more than security. We want to keep Caliptra very clean and lean.
> 
> Bryan Kelly, Microsoft Principal Firmware Engineer – Lead Hardware Security Architecture

![](z-images/66d4a1b26db7538fcdf38561084d2ac7.webp)

We are excited about this and believe it will come to fruition. If you are a hardware or security architect, you should strongly consider joining the project. Eventually, Caliptra will have to be implemented into future designs that are sold to Microsoft and Google.

If you are a fan of open-source, consider sharing the word about the project!
