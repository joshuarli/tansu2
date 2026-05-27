---
title: "The Future Of Military Sensing And Communications Systems – Co-Packaged Optics Enable Converged RF Phased Arrays"
date: "2022-11-02T12:02:52.145Z"
url: "https://newsletter.semianalysis.com/p/the-future-of-military-sensing-and"
author: "Dylan Patel"
description: "Lockheed Martin NGAD enabled by Ayar Labs"
---

Warfare is evolving rapidly due to the advancements in semiconductors and sensors. The model of massive budgets for single programs that take decades to churn out a few hundred units of equipment is facing tremendous pressure. Stealth, drones, and mass-volume manufacturing of precision-guided missiles are rapidly changing the equation of defense. Currently, the most advanced militaries have dozens or hundreds of fighters and bombers but tens of thousands of drones and missiles. It’s unknown if modern militaries can combat or even reliably track a high-density swarm of these new weapons with existing capabilities.

Ayar Labs and Lockheed Martin published a fascinating paper regarding radio frequency (RF) converged phased array antennas utilizing silicon photonics for communications. This solution could answer this problem. Today we want to explain current sensor, and communications architectures of defense systems, cost and performance issues with these architectures, digital beamforming, MIMO, RF phased arrays, and silicon photonics for defense applications. Special thanks to the SPIE Optics and Photonics conference, presentations, and papers as they are helped tremendously in the writing of this.

![](z-images/dbf9d1ada1d12546b18b2e6d73ef27a1.webp)

First, let’s discuss modern sensor and communications architectures. This is a demonstrative model of a modern jet fighter such as an F-22 Raptor or F-35 Lightning. These aircraft use arrays of sophisticated sensors for targeting, tracking, communications, and more. The F-35, for example, was a [pioneer in infrared sensor systems](https://www.lockheedmartin.com/en-us/products/f-35-lightning-ii-eots.html). This system utilizes many arrays of electro-optical antennas to give it a 360-degree view of everything around the aircraft. This greatly improved the fighter’s capabilities regarding searching and tracking targets. The biggest flaw of this system is that its flexibility is quite limited. The entire subsystem lives in its own bubble with its own processing pipelines.

> Each aperture is tightly integrated into its corresponding RF system, and cannot be utilized by a different system without either physically rewiring the platform, or retraining an existing system to accommodate the needs of another system.
>
> Lockheed Martin

![](z-images/e9c18f0c9f312055aea591954e227149.webp)

Deploying these sensors in a defense application, requires a whole host of very custom work, from the physical electro-optical infrared sensor development through to processing and algorithms. Developing this system is incredibly costly and involves many disciplines that must work together for a long period of time to develop completed systems. The electro-optical infra-red system will be completely separate from another RF sensing or communications system.

In many cases, each sensor is optimized for that particular use case. A modern military must have RF systems designed to detect, track, connect, and communicate with various planes, drones, missiles, helicopters, satellites, ground-based weapons systems, ships, submarines, and more. As more RF subsystems are created for interfacing with these various elements of the battlefield, friend and foe, the complexity and costs skyrocket.

![](z-images/2b0170b76f1f7e23e909523d7b2c940c.webp)

These advanced military applications are beginning to require dozens of different subsystems, and the costs are ballooning. Furthermore, delays with a single subsystem mean the entire platform is now delayed. The F-35 is often bashed for these delays and costs. While the exact causes of various delays are unknown, the monolithic planning and complexity involved with creating such a complex system is the culprit. Now that the F-35 is working and deployed, it is considered leagues ahead of any other fighter in the world, and the RF subsystems are a big part of that.

![](z-images/0823bf33dd615f6ec71cbbf01c017b45.webp)

Imagine if these many different RF subsystems could be developed and deployed in a disaggregated manner. Instead of monolithic subsystems where sensors, RF processing, and application space are all built for each specific task, the solution space is reframed. A few major classes of sensors could be optimized for RF gain, noise, and other attributes instead of being tuned for the exact use case. The RF processing algorithms could be updated on a faster cadence to introduce new sensing and communications capabilities based on the data coming in and being sent out of these RF elements. The application algorithms could also be updated on a separate cadence to react to evolving battlefields. Rather than costly 20-year programs, the timeline for bringing advanced technology would be rapidly shortened.

Above is a demonstrative example of an NGAD fighter with only two types of sensors. A high-performance phased array antenna array and an electro-optical infrared antenna array. Versus the demonstrative example of the F-22/F-35 fighter, there are significantly fewer sensor types. Despite the reduced types of sensors, disaggregating sensors from processing would enable enhanced capabilities for tracking more, smaller, and stealthier targets.

![](z-images/9de942a36f2a740f2baa4c75e85dd1eb.webp)

The various RF sensors would be converged before processing. With techniques such as MIMO and digital beamforming, higher data rates and less noisy signals can be obtained.

Digital beamforming and MIMO (multiple input, multiple output) are technologies that have been utilized in the past, but more complex algorithms and techniques continue to drive the performance of RF systems. We haven’t ever explained beamforming or MIMO in a public report, so we will provide a quick primer. Please recognize that we are oversimplifying it; many books have been written about these topics.

![](z-images/3546a1bce4959a3f905d944032db455a.webp)

MIMO is when there are multiple inputs and multiple outputs for a transmit and receive device. The benefits for the total data throughput are huge. For reference, 5G small cells have in the range of 64 transmit and 64 receive pairs. The path for getting huge volumes of data in and out of a next-generation aircraft is clear, given that the consumer market has proven these technologies.

The less intuitive aspect of MIMO is regarding RF sensing applications. Imagine if the transmit side is a drone or a stealth aircraft. That enemy is not actively attempting to signal the fighter. They are attempting to mask their radar and infrared signatures. Imagine how difficult it is to pick up the signals emitted or radiated off the low radar signature combatant covered in radar-absorbing materials. Sensing applications require the location, heading, velocity, and rate at which a foe makes maneuvers to be known. The combat response will differ depending on whether the sensing system detects the unidentified object as a bird, drone, stealth fighter, stealth bomber, or missile.

MIMO regarding sensing lets a broader range of outputted signals be picked up over a larger effective area. This is also [where digital beamforming](https://www.youtube.com/watch?v=A1n5Hhwtz78) comes in. Just like MIMO, it is already used in commercial applications, but the use cases for military applications are unique. All the receive antenna arrays will receive slightly different phases and amplitude for signals due to propagation delays.

![](z-images/7d420b19c015ceda53824d3798da146f.webp)

When there are objects and signals in multiple directions, digital beamforming allows the system to focus in on a specific signal. The various receive antennas will sync their timing to a particular direction and distance by introducing nanosecond-level delays to the antennas receiving the signal first. Once all signals are synced up perfectly for that specific distance and direction, the outputs from the various receive antennas can be added together. The focal point of these antennas will have its signal amplified, while all other objects will be noisy and can be filtered out. Check out [this video](https://www.youtube.com/watch?v=A1n5Hhwtz78) for further explanation.

![](z-images/f0a989923cffa81cbd9ef643450e6893.webp)

Beamforming can be analog or digital in nature. The advantage of digital beamforming is that each processing element receives the raw data and uses digital signal processing to steer the beam through analysis of the dataset. This processing can occur simultaneously for many different focal points enabling the detection of swarms of much smaller objects like thousands of drones and missiles.

The move to a converged architecture requires the antenna arrays all around the aircraft to be able to be processed centrally rather than individually at each antenna array. Compare and contrast the current generation architecture (1st image) and the next generation architecture (2nd image).

![](z-images/e9c18f0c9f312055aea591954e227149.webp)

![](z-images/9de942a36f2a740f2baa4c75e85dd1eb.webp)

The IO requirements are massively higher with the next-generation architecture. All the 100s of GB/s coming from the sensors must be sent to a central switch before going to the various processing types, which is an explosion in networking IO speed requirements.

The crux of the idea is that instead of independently building isolated systems, they can make one extensive network that can accomplish every task together, which is only possible with extremely high-speed and efficient networking.

![](z-images/0e670f6942fcc7c7c6d7abdbb606ffa1.webp)

This is where [Ayar Labs’ co-packaged optics](https://www.semianalysis.com/p/ayar-labs-co-packaged-optics-revolution?s=w) comes in. As a refresher, check out [our prior report on the firm, which details their co-packaged optics solution for the datacenter](https://www.semianalysis.com/p/ayar-labs-co-packaged-optics-revolution?s=w). Optical IO is far more efficient than an electrical form. Ayar Labs and Lockheed Martin are researching the integration of TeraPHY co-packaged optical IO chiplet with RFICs for building advanced packages with these capabilities. Sensors, switches, and processing elements could theoretically use this optical IO for dramatically lower power consumption and higher bandwidth.

![](z-images/f41dc3dd15cd151b88b5f7ce88b2e22a.webp)

Utilizing co-packaged optical IO has multiple benefits beyond lower power and higher bandwidth. First, there is much lower electromagnetic interference (EMI). Electrical copper-based interconnects must deal with interference from higher radiation levels, the earth’s magnetic field, or combatants’ countermeasures. This interference can then cause errors in the signal being transmitted. Copper-based wiring deployed in aerospace applications requires significant shielding to prevent these issues.

Furthermore, with high-speed copper signaling, there are propagation and signal loss issues, so wiring runs are limited in length. These loss-related issues are compensated by running lower gauge, thicker wires. This introduces problems with aerospace applications as hundreds or thousands of cables are routed around an aircraft. If each wiring run is a thick gauge of wire with EMI shielding, then this wiring will take up significant space and weight budget.

Both these issues are not as relevant with co-packaged optical IO. Glass fiber optic cables require minimal shielding because they are impervious to most EMI. Glass fibers are much thinner, lighter, and more flexible. These characteristics enable wiring in much tighter spaces.

![](z-images/df9a8e61d53f83fed2054c86184bedac.webp)

Ayar Labs and Lockheed Martin compared the co-package optical IO to the existing state-of-the-art mid-board optical transceivers. The comparison shows that co-packaged optics have lower power, lower area, lower error rates, and higher performance. Mid-board transceivers are currently used in some military applications, although we aren’t sure where. The suppliers all have a bucket for “defense” applications.

Another interesting aspect of this research is that it could generate synergies with Ayar Labs’ current push into the datacenters. Datacenters have been reluctant to adopt co-packaged optics due to the fragility and reliability concerns. Ayar Labs will be able to prove its technology in a much more demanding application. Humidity, G-forces, laser lifetime, and temperature swings are still significant challenges, but progress is promising. Some of these learnings could be applied in the much larger datacenter communications market.
