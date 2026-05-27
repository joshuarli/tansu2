---
title: "Qualcomm MWC 2021 - Network Infrastructure And Edge 5G Get Supercharged | FSM200, DU X100 Accelerator, And Range Of Features"
date: "2021-06-29T12:03:18.031Z"
url: "https://newsletter.semianalysis.com/p/qualcomm-mwc-2021-network-infrastructure"
author: "Dylan Patel"
description: "Qualcomm at MWC 2021 was quite the eventful show despite the lack of large consumer technology announcements."
---

Qualcomm at MWC 2021 was quite the eventful show despite the lack of large consumer technology announcements. They showed off two new hardware platforms as well has a whole host of other innovative features they are bringing to market within 5G infrastructure and edge. These solutions are all tend to be very efficient on power, have relatively low cost, but they increase network efficiency by a large amount. Virtualized, interoperable, and modular are the themes for Qualcomm’s announcements and technology showcases. They are leading the way with building a cloud native telecom infrastructure.

![](z-images/932795d4f14ffef1a47feecad098d19b.webp)

Qualcomm is introducing the FSM200xx which is their second-generation solution for small cells. It’s manufactured on a Samsung 4nm LPP process technology with half the die size of the previous generation FSM100xx. This new product is the only one hitting the market with full support for all features within GPP Release 16. In addition, the spectrum offerings are bumped up over the last generation to include the new n259 (41 GHz), n258(26 GHz) and FDD bands. FSN200 offers oRAN/vRAN capabilities for maximum flexibility.

The FSM200 platform has up to 8 Gbps with 1 GHz bandwidth support on mmWave and supports spectrum aggregation of 200 MHz of Sub-6 GHz spectrum across FDD and TDD to reach data speeds of up to 4 Gbps. None of the demos or claims specifically stated this was at the same time. SemiAnalysis believe there is a 10Gbps total network bandwidth cap on the platform.

The FSM platform offers a unique feature that dramatically reduces rollout costs, Power over Ethernet (PoE). This PoE capabilities allow utilization of power and backhaul from one source which simplifies deployments and reduces cost. Due to the platform’s low cost and power, it can be deployed at high densities indoors and outdoors.

![](z-images/77039dcdc69f14a169902ee1cc6b588f.webp)

While the FSM200 platform offers the ability to easily augment a network and add more capacity and bandwidth with more cells, the 5G Distributed Unit X100 Accelerator Card simplifies vRAN/oRAN deployments. It is meant to be an inline accelerator for demodulation, beamforming, channel coding, and Massive MIMO computation needed for high-capacity deployments.

vRAN/oRAN have largely been bottlenecked by the use of standard CPUs or mismatched acceleration capabilities. The physical layers of the RAN protocol stack are characterized by real-time functions and complex signal processing algorithms. Moving to a vRAN/oRAN platform would decrease performance or increase latency without adequate acceleration.

As such, the industry rushed to use various FPGAs and ASICs for offloading various RAN functions. Initial accelerators were mainly utilized in look-aside mode where the accelerator was only ever addressed by the main processor. This worked for forward error correction, which is what most FPGA based solutions are deployed in. As 5G infrastructure has matured, the use of FPGAs in 5G has also decreased commensurately.

![](z-images/ede55d1c6ca57c5ea1b44aee694337b1.webp)

Inline accelerators directly interact with the main processor as well as the RAN. Nvidia is also attempting to use GPUs as inline accelerators in 5G deployments. Their push feels like putting a square peg in a round hole compared to Qualcomm’s solution which is more modular and interoperable with the entire ecosystem. We have questions in with Nvidia to get some more information because their press release on Aerial left many questions unanswered. Qualcomm is targeting the DU X100 accelerator card to slot into existing designs to boost existing deployment capabilities or allow their telecom partners to purchase them utilize them alongside general-purpose low-cost CPU platforms.

The Qualcomm 5G DU X100 is a PCIe inline accelerator card with concurrent Sub-6 GHz and mmWave baseband support. It is designed to simplify 5G deployments by offering a turnkey solution for ease of deployment with O-RAN fronthaul and 5G NR Layer 1 High (L1 High) processing. Qualcomm’s open approach is one that operators and OEMs love because it does not shoehorn them into any single solution for their problems. They can select the hardware for the specific deployments instead of a 1 size fits all HW platform.

![](z-images/d82aa5a9940e74e1cc08368078703b1b.webp)

Qualcomm is committed to being the leader with every major 3GPP release. Their client-side modems and infrastructure hardware are hitting the most up to date feature set with every release. In addition to the infrastructure hardware, they released today, they demonstrated demos of future 3GPP Release standards. The first of many they are pioneering is 5G NR Light (Red Gap). With Release 17 bandwidth can be scaled down to 20MHz in sub 7Ghz frequencies. Release 18 will bring 5Mhz. Scaling down allows much lower transmit power and network congestion.

![](z-images/7dda22cf9b2b6366963d221a83385078.webp)

Bringing 5G NR Light will allow a massive increase in the number of devices connected to the 5G network from supply chain sensors, asset trackers, wearables, smart video cameras, sensors, and much more. In addition to allowing smaller devices, relay’s will be supported in upcoming 3GPP releases through Sidelink. Sidelink allows devices in the network to communicate with each other. A potential use case is allowing supply chain sensors on cargo to connect to a relay within a truck to dramatically reduce their power and increase range. When it is in a warehouse or factory, it can connect to the much denser local 5G network inside.

![](z-images/cafb536a69677de6fea24b96fa18f446.webp)

Sidelink is also useful in other capacities. Many self-driving applications will want to utilize advanced Qualcomm modems for V2X communications. These modems can be used with communicating with the greater network as normal, but they can also communicate with other 5G devices. This data can help with creating higher resolution 3D maps as vehicles share their mapping and positioning data with each other.

![](z-images/e2346f6c70c949a73feada94ed6922bc.webp)

The beauty of V2X is that it is done on the dedicated 5.9GHz spectrum without any telecom subscription required. This technology is starting to be deployed in China already and will deploy next year in the US. Pedestrian and vehicle safety can greatly be enhanced due to the addition of Sidelink.

![](z-images/7c98e1ce31832c69446e76ed93e4d00e.webp)

In addition to communications with other devices, self-driving vehicles will want to use 5G for high precision positioning. Positioning can be done with standard algorithms which use round trip time and angle of arrival to estimate a 3D position. This generally only has accuracy of about 2 meters, far better than any satellite GPS network that is available to consumers.

Furthermore, Qualcomm has utilized machine learning to create sensor fusion by combining the 5G positional data with GNSS satellite positioning and gyroscope data. The neural network can now realize a position down to within a single centimeter. This technology works indoors, parking garages, or even tunnels where GPS satellite positioning tends to lose a lot of accuracy.

![](z-images/952b8f437f7bbcef8aaca6c5018f8552.webp)

Qualcomm is pushing 5G into the factory with products such as FSM200, and their embedded chips/modems. Features such as Sidelink and 5G positioning are especially important because they allow devices to communicate with each other or robots to pinpoint exactly where various items are within a factory. They envision their extended reality technology coming to the factory to allow workers to have important information at their fingertips at all times. These workers will be able to rapidly react to any errors or breakdowns. The extended reality devices will also assist workers with jobs by pulling up relevant information about the device they are looking at.

![](z-images/94c71137546f8ea07ab0932a39b1928a.webp)

In addition, they are rolling out more useful two features for the smart factory well before anyone else. Time Sensitive Networking (TSN) allows synchronization of devices at sub-microsecond speeds for various sensors such as cameras, robots, actuators, and other mechanical or data gathering elements. Ultra Reliable Communication (URC) allows the fusion of Sidelink and multiple transmission and reception points (TRPs) to sidestep any broken or signal interference. These features enable wireless ethernet to be supported for time sensitive networking for microsecond level synchronization. Through the use of Sidelink, TSN, URC, and 5G positioning, robots can now reliably retrieve items and move forward the manufacturing process.

![](z-images/f5bc87ecf08c6d5fa55a2a60af12c2c3.webp)

Qualcomm’s work goes beyond the industry standards. They are attempting to rethink the entire stack using machine learning approaches. Some of these have already been successfully showcased and are being productized currently. For example, the newest generation of mmWave beam forming utilizes machine learning to increase uptime and reduce variability in latency. A higher quality of service is being driven by neural networks estimating if and where to beamform in advance of the device’s movement. Other areas where neural networks are being applied are for channel state information feedback and positioning and sensing.

![](z-images/178d961bfacceb9c8a579b611c85dc0f.webp)

Qualcomm is also using machine learning to assist with network planning and deployment. They have a wide variety of offerings from wireless backhaul infrastructure, small cells, and different types of repeaters. They utilize publicly available data such as Google Maps, OpenStreetMap, and other GIS data. This data is run through a network to map out buildings, the construction materials, and objects such as signs, power lines, and foliage. This mapping data is then combined with traffic data to optimize network deployments for bandwidth, latencies, and density, and cost.

![](z-images/5bd08992a1fab692abdb940492fb24a8.webp)

Qualcomm is introducing mmWave repeaters aswell. They evaluated 3 different forms. Rather than having to run networking to each site, Qualcomm envisions using a few cells for backhaul. These could directly serve the devices on the network, but they also can be connected to various repeaters to enhance the signal. This can greatly reduce the cost of rolling out a 5G mmWave network.

![](z-images/5bd08992a1fab692abdb940492fb24a8.webp)

Qualcomm Boundless XR demo was one of the most impressive showcases of technology. They demonstrated 3 users simultaneously interacting in VR with exceptionally low latency. This demonstration involved a single mmWave cell using only 100MHz of spectrum and an Nvidia GPU based edge server system. Two users were interacting with each other in VR chat while the third played a PC class VR game. All users held steady 90FPS with full 2160x2160 resolution per eye. The entire 5G system added less than 20ms to the motion to render to photon latency metric. Qualcomm says the next 3GPP Release will be capable of more than 12 users on a single small cell using the same 100MHz of spectrum while maintaining the same low latency. We look forward to this being scaled up to the city level for augmented reality applications.

![](z-images/847e33108704cb82b192df0d146df2d3.webp)

In all, despite a big lack on consumer hardware, this year’s MWC announcements may be Qualcomm’s best yet. They have shown off numerous infrastructure demonstrations and are starting to launch the capabilities to build these networks. Instead of just throwing their hands up and saying they have the best modems, Qualcomm is taking their rapid innovation to the network infrastructure as well. Whether it’s through their rapid hardware iteration, machine learning prowess, or radio fronted expertise, Qualcomm is poised to capture large share in the 5G infrastructure and emerging 5G applications such as factories, supply chain, and automotive!

*This article was originally published on [SemiAnalysis](https://semianalysis.com/qualcomm-mwc-2021-network-infrastructure-and-edge-5g-get-supercharged-fsm200-du-x100-accelerator-and-range-of-features/) on June 29th 2021.*

*Clients and employees of SemiAnalysis may hold positions in companies referenced in this article*.
