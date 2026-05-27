---
title: "Google OCS Apollo: The >$3 Billion Game-Changer in Datacenter Networking"
date: "2023-03-17T22:02:14.324Z"
url: "https://newsletter.semianalysis.com/p/google-apollo-the-3-billion-game"
author: "Dylan Patel"
description: "Custom Optical Switches Reduce Broadcom's Networking Dominance"
---

Networking is a critical part of any datacenter, especially with the rise of networking-intensive large language models. As such, it was a clear target for Google’s infrastructure optimization efforts. Over the last year at conferences such as OFC and SIGCOMM, Google disclosed their custom networking stack, Jupiter, from in-house switches all the way through to custom reconfigurable software.

This custom networking stack enables them to save at least $3 billion versus the industry standard implemented by competitors such as Amazon and Microsoft. In addition to cost improvements, Google also achieves higher network performance and lower latencies! This custom networking stack started being deployed more than 5 years ago and is now implemented in most of Google’s datacenters. Google’s custom networking was an integral part of training their most advanced large language models, including PaLM.

Before diving too deep into how their custom networking stack works, let’s quickly discuss what it does and the industry implications. First off, Google claims their custom network improves throughput by 30%, use 40% less power, incurs 30% less Capex, reduces flow completion by 10%, and delivers 50x less downtime across their network.

Most importantly, they can stagger datacenter networking upgrades. Google’s custom switch also enables them to eliminate the purchase of Broadcom networking switches in their spine layer of the network.

The traditional network uses a “Clos” topology which is also referred to as a spine and leaf configuration, to connect all the servers and the racks of said servers together in a datacenter. In a spine and leaf architecture, you have a spine, leaves, and compute. Compute is a rack of servers full of CPUs, GPUs, FPGAs, Storage, and/or ASICs. That compute is then connected to leaves or top-of-rack switches, which then connect up through various aggregation layers to the spine.

![](z-images/d5b5de4bc73a1dd455c1acf9642775e3.webp)

Traditionally the spine of this network uses what is called Electronic Packet Switch (EPS). These are the normal network switches of which Broadcom, Cisco, Marvell, and Nvidia are the leading providers. However, these EPS use a ton of power. Furthermore, every 2 to 3 years, networking speeds have doubled. While this doubling improves power consumption, it also comes with the requirement of upgrading the existing spine EPS. As such, there is always a huge wave of Capex associated with every new generation of Broadcom Tomahawk switch.

![](z-images/b4c831ae754fe4647d278106107de743.webp)

Google embarked on a project called Gemini to remove this spine layer of their datacenter networks which allows them to reduce both the power and the Capex costs associated with this layer of switching. Furthermore, this project doesn’t stop at the spine. It will continue to improve and potentially be adopted at lower layers of the network.

![](z-images/9841d85cdf894bb6acd6ae6df2d3d11d.webp)

Project Apollo is focused on replacing the traditional “Clos” architecture, which uses EPS with Optical Circuit Switch (OCS). The first generation optical switch is called Palomar. These OCS replace the spine of the old “Clos.” Instead of converting the signal from electrical to optical to electrical multiple times in the spine layer, OCS is an entirely optical interconnects which uses mirrors to redirect incoming beams of light, which are encoded with data from a source port to a destination port.

To use an analogy, OCS is like a railroad switch. They can have multiple paths, but the train can only traverse one specific track/path at a time. In order to change what path the train will travel, you have to redirect the track manually.

![](z-images/f6cc260c3350abdd27ab847f6c9b3d86.webp)

In the case of Google’s network, if a section of the datacenter connected through port 7 wanted to talk to another section of the datacenter connected through port 4, but it was configured to port 11, then the optical switch has to reconfigure these mirrors to let port 7 to talk to port 4. Note that with a traditional EPS, there is no need to manually reconfigure anything because all ports are always connected through an electrical switch.

![](z-images/861a8f725b8f0c6ab4b06accef9bcdb7.webp)

Google uses these optical switches in a direct connect architecture to directly connect the leaves through a patch panel. This is not packet switching; this is, for all intents and purposes, an optical cross-connect.

![](z-images/7f72dc8934edfda9a65166651f30eb68.webp)

To use the train analogy again, this is a massive train station with multiple tracks in and out. Any train coming in can be transferred to any train coming out, but it requires reconfiguring at the station.

Note in a typical network architecture; there is a packet header that is associated with every packet of data. This packet header is decoded and determines where the electrical switch will send that packet. There is no packet decoding happening in Google’s OCS. The packet is on a pre-determined path before it ever reaches the OCS. If you need to change what port you are talking to then you need to characterize the flow of the packets and where that flow is going. You need to know where the train is going before it ever enters the station.

In general, OCS is a “set it and forget it” solution because moving the mirrors to reconfigure the routing of packets flowing through the OCS takes several seconds. Compared to a traditional EPS, that is an eternity. You need to set the track the train will follow before it ever arrives.

![](z-images/0ec9294d16a436e82fe023a31e47d1e2.webp)

Google’s OCS is not a drop in replacement for EPS, the network has to be explicitly designed with OCS in mind to account for mirror reconfiguration time.

## Advancing with Apollo: Data Rate Agnosticism, Low Latency, and Power Savings Unlocked

The lack of flexibility and the non-drop-in compatibility are big drawbacks, but there are numerous advantages of OCS. Google outlines three big advantages: Data rate and wavelength agnostic, low latency, and significant power savings.

Data rate and wavelength agnosticism are important for two main reasons. The first reason is that you gain interoperability with any switch and optics technology which means that if you need to connect a switch with a 100G transceiver with a switch with an 800G transceiver, OCS can do that with no issues due to it just redirecting light instead of it moving packets.

![](z-images/c227bb29084fa8a755dff581ef57598b.webp)

Once the OCS are set up, you can upgrade your switches and optics to much faster generations without having to swap out the “spine” of the network. The OCS can have a much longer lifespan than a traditional EPS.

![](z-images/48c912ed6447c0bc23c425b7e10dfe7c.webp)

A traditional EPS will have optical fibers come into the back of the switch, be converted to electrical signals through a photodetector and TiA, be [redriven and retimed through a DSP](https://www.semianalysis.com/p/marvells-dsp-dilemma-networkings), sent across a PCB, into standard switch silicon where the packet is decoded, and the path is determined. Then the packet is reencoded and sent out across that entire path again. Each of these steps incurs additional latency.

![](z-images/a31996e0da159c6b7d6c4738dd107bb5.webp)

The low latency of OCS comes from the fact that OCS does not have to decode packets; all they have to do is bounce the incoming light from the source port to the destination port.

![](z-images/d70dbd27af1618cb54786f791085ab72.webp)

This leads to the third and biggest advantage, which is power. Each of these steps in a traditional EPS consumes a bit of power as well.

![](z-images/9ed1b9f378c19f34f6a9fda249f9edbc.webp)

We will have more on the performance benefits and power benefits in the supplementary section below.

## OCS Obstacles: Addressing High Upfront Costs, Insertion Loss, and More

There are four major disadvantages to OCS, all of which Google has claimed to have solved. The four major disadvantages are: high upfront cost, insertion loss, reconfiguration time, and lack of drop in support.

High upfront costs are something that Google can depreciate over a long period of time. Because OCS can deal with any bandwidth when Google moves to leaf switches to use 1.6T and 3.2T transceivers, these OCS don’t need to be replaced, which offsets the upfront costs. Google estimates that the overall Capex of the OCS is about 70% that of standard EPS due to the ability to reuse the OCS through multiple upgrade cycles.

![](z-images/afe8ecb56cdec7ec5c5ed62e2c0aff52.webp)

If we assume that Google expects OCS to be used for 3 upgrade cycles, then the upfront cost of an OCS is ~3.5X that of an EPS (ASPs grow each generation of EPS). If Google believes these OCS can last 4 generations, then the upfront Capex difference is more like 6x!

Insertion loss is the next major disadvantage of an OCS. Insertion loss refers to the amount of signal power that is lost when an optical signal switches its medium of transport. For example, from a laser to a silicon photonics chip or a fiber to the photodetector. It is typically measured in decibels (dB) and is a measure of the reduction in signal strength. The higher the insertion loss, the more signal power is lost. For example, if a device causes a 3 dB insertion loss, the output signal power will be half of the input signal power.

![](z-images/2bcec1039ad2caf8eb8bfabab69eb53c.webp)

The more insertion loss you have, the weaker your signal will be, which could result in the unreliable transmission of data. Insertion loss is measured in decibels, and the fewer decibels of loss, the better and while the standard insertion loss for optical fiber is around 6dB, Google has reduced that to a worst case

Reconfiguration time is another major issue. Reconfiguring the mirrors for a different path takes a few seconds. Google has solved this by profiling its network traffic in detail.

![](z-images/b658e0e3008938d1379c2d7279cb5535.webp)

They believe that building networks for the worst case of traffic patterns is overkill and that by planning network traffic, they can get away with the long reconfiguration time for mirrors.

![](z-images/c67b0ac22fc8e1c0ed2c688e97539847.webp)

Lack of drop-in support is something that Google has solved by redesigning their networks in order to support OCS. Google has spent “a decade of evolution and production experience” with Jupiter and Project Apollo has been a significant step forward in Google’s drive to reduce TCO of these large networking systems. This is a part of secret sauce which Google won’t share publicly, although there are some details we can share after explaining the hardware.

## Palomar MEMS Mirror Package: Unveiling the Heart of Google's Optical Circuit Switch

The Apollo Project at first used a vendor-based solution for their OCS. Huawei also used this same vendor for their different use case in networks.

> Due to the difficulties in maintaining reliability and quality of this solution at scale, the decision was made to internally develop an OCS system.
> 
> Google

That internally developed OCS is called Palomar.

![](z-images/0d1f6e8a2b2ad1cb1a67b637464155ba.webp)

The centerpiece of the Palomar OCS is the Palomar MEMS mirror package which has 176 individually controllable micro-mirrors. However, only 136 mirrors are used due to 40 being disabled for yields.

- MEMS stands for Micro-Electro-Mechanical Systems. They are miniaturized mechanical and electro-mechanical devices that are integrated with electronic components and fabricated using microfabrication techniques.

![](z-images/4b9e8cf552606895e7d8582c1f1dd70f.webp)

The way that the different mirrors work is that the incoming 1310nm signal light (O band) is merged with a second 850nm light using a dichroic beam splitter which lets the 850nm through but reflects the 1310nm light. A dichroic beam splitter is simply an angled mirror with a coating on it that allows the transmission of certain wavelengths of light through it while reflecting other wavelengths of light.

In the case of the Palomar OCS, the wavelength of light that you want to transmit is 850nm light, and the wavelength that you want to reflect is 1310nm light. You do lose some of the light to losses incurred by the split due to not being able to reflect or transmit 100% of the light, but you can get well over 90% of the light where you want it.

![](z-images/394dc203f39787fb68e8185fc8935e8b.webp)

From there, the merged light is bounced using the MEMS array to a second dichroic splitter which bounces the 1310nm back to the MEMS array but lets the 850nm light into a camera that monitors the alignment of the MEMS array. This alignment of the MEMS array is important because if the alignment of the array is just a little bit off then that would cause a break in the transmission of the data.

![](z-images/6b9228277405986fc0b8cefe6481e298.webp)

There are 2 of these 850nm lights in order to maintain the MEMS array alignment, so the 1310nm light is still combined with the 850nm light when it bounces a second time off the MEMS array. Then when the combined beam hits the final dichroic splitter, this splits out the 1310nm to go to the output port.

![](z-images/13f4e0fedaa892bd39904cd1782ae9ad.webp)

In order to cut the number of OCS ports and fiber cables in half to keep the complexity of the system down, Palomar uses optical circulators to have a bi-directional link. The optical circulator is a 3-port device where the input of port 1 is directed to port 2, and the input of port 2 is directed to port 3. This allows the conversion of a standard duplex transceiver into a bi-directional transceiver.

![](z-images/6bd7a05ff0b8063860642249ae45d6a4.webp)

This added return loss and crosstalk. Return loss is signal loss that happens at the end of an optical cable. The change in the refractive index of the light going from the optic fiber to a different medium, such as air, causes signal degradation, and a high optical return loss can cause the laser to not transmit correctly.

Crosstalk is when there is interference between two channels, which causes signal degradation and an increase in noise levels. So Google moved from using erbium-doped fiber amplifiers, which were limited to the 1530nm to 1565nm wavelength range (C-Band), to using optical coatings along with an optical re-design in order to be able to use the 1310nm wavelength range (O-Band). This re-design also reduced the return loss and the crosstalk of the system.

![](z-images/362f4c470efaf40b26008d5bb2a1b86f.webp)

Google adopted Wavelength-division multiplexing (WDM) optical transceivers for Apollo. WDM is a technology that takes multiple optical signals and runs them through one optical fiber by using different wavelengths of light. The first generation of Apollo used the 40Gb/s standard as the baseline. This is a standard adopted across the industry (CWDM4 MSA), so the optics are standardized and commodity. The only unique aspect of the solution is the MEMS-based switch.

![](z-images/41ac6b0b5bebc219b27accb97e10b371.webp)

## Conclusion & Future

Google, with their Apollo project, has developed a non-blocking 136x136 optical circuit switch that is both forward and backward-compatible with any bandwidth or wavelength Google uses or will use in its data centers. This switch, according to Google, only uses 108 watts of power consumption. Compared to a standard 136 port EPS switch, which would be in the 3,000 watts range.

So while there are disadvantages to OCS, Google has created a solution that has far more upsides than there are downsides for them. And over the past 5 years, “tens of thousands of 136x136 port OCS (eight spare ports) were manufactured and deployed.” Google has created a system that works incredibly very well for them.

In the future, Google is looking at a larger port count OCS for further scale-out capabilities as well as faster switching speeds to allow wider adoption of OCS in the lower layers of the network. This broader adoption would be tremendously negative to Broadcom, the leader in hyperscale networking switches. Furthermore, Google says they will also continue to improve reliability and lower insertion/return loss.

Google is also investigating piezo-based switching technology as a replacement of the current MEMS-based system due to a piezo system having inherent advantages in insertion and return loss over MEMS systems. Switching speeds could also be faster. Google also shared their investigations with regards to MEMS, Robotic, Piezo, Guided Wave, and Wavelength Switching. Their investigation included relative costs, port count, switching time, insertion loss, driving voltage, and latching. We will share that below.

## TPU Use

OCS is used in all of Google’s TPUv4 and TPUv5 systems as well. It is a huge part of their superior perf/TCO.

## Future, Supporting Data, Software, and Performance

Below, we are sharing many files, images, and papers associated to the OCS. This includes traffic data and adoption of the OCS by Google. Included is also a picture of the switch as well as how Google profiles their traffic and implements the OCS. Furthermore, it shows the network performance benefits beyond just cost which was the main focus above.
