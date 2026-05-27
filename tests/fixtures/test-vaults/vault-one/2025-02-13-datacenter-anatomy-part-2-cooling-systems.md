---
title: "Datacenter Anatomy Part 2"
date: "2025-02-13T16:09:36.000Z"
url: "https://newsletter.semianalysis.com/p/datacenter-anatomy-part-2-cooling-systems"
author: "Jeremie Eliahou Ontiveros"
description: "L2A, L2L, Immersion, Two-Phase, Google vs Meta vs Microsoft vs Amazon Water Cooling Design, WUE, PUE, Nvidia Rubin Power & Cooling Architecture"
---

### L2A, L2L, Immersion, Two-Phase, Google vs Meta vs Microsoft vs Amazon Water Cooling Design, WUE, PUE, Nvidia Rubin Power & Cooling Architecture

Cluster deployments are an order of magnitude larger in scale with [Gigawatt-scale datacenters coming online at full capacity much faster than most believe.](https://semianalysis.com/datacenter-industry-model/) As such, there are considerable design changes that Datacenter developers planning future sites must consider. We previously covered the [Electrical system of Datacenters](https://semianalysis.com/2024/10/14/datacenter-anatomy-part-1-electrical/) and how the rise of Generative AI is impacting datacenter design and equipment suppliers. In the second part of this series exploring Datacenter infrastructure and technologies, we’ll focus on Cooling Systems.

Nvidia shook the entire Datacenter Industry in [March when it announced that its state-of-the-art AI computing platform](https://www.semianalysis.com/p/nvidia-b100-b200-gb200-cogs-pricing) would be a 120kW, 72-GPU rack exclusively cooled via Direct-to-Chip Liquid Cooling (DLC). The [Nvidia GB200 NVL72 system will provide the best TCO for Large Language Model (LLM) inference](https://semianalysis.com/2024/04/10/nvidia-blackwell-perf-tco-analysis/) and training, and will be instrumental towards enabling advancement according to [scaling laws](https://semianalysis.com/2024/12/11/scaling-laws-o1-pro-architecture-reasoning-training-infrastructure-orion-and-claude-3-5-opus-failures/) and [reductions in costs of reasoning models like o3](https://semianalysis.com/2024/12/25/nvidias-christmas-present-gb300-b300-reasoning-inference-amazon-memory-supply-chain/). As such, the GB200 NVL36/72 will be the [highest volume SKU of the Blackwell product family](https://semianalysis.com/accelerator-industry-model/) – and this is just the beginning of Nvidia’s extremely ambitious roadmap.

![](z-images/28c15175d0e7e4ce3adf80d2bad0d78e.webp)

Source: SemiAnalysis Datacenter Model

DLC is not a new technology, but it has long been confined to cost-insensitive R&D government supercomputers that operate at >100kW rack density - and [Google's custom AI infrastructure](https://www.semianalysis.com/p/google-ai-infrastructure-supremacy). In the broader market, rack density has been rising slowly over time, from at most 5-10kW per rack in the 2010s up to the 15-20kW that is typical for modern Cloud Computing datacenters. The Hyperscale era caused an increase in scale of operations, but the underlying Datacenter design was fundamentally unchanged.

## The Upcoming Datacenter Cooling Market

Of the key datacenter systems, Cooling is arguably the area that is evolving at the fastest pace, presents the steepest learning curve and carries the execution risk for datacenter operators. With large-scale projects commonly requiring billions in capital expenditure, the stakes are extremely high. Rapid advancement in datacenter requirements also amplifies the risk of developing assets that could become obsolete quickly.

Demand for Liquid Cooling is underestimated and will lead to an increase in inefficient “bridge” solutions as there won’t be enough liquid-cooling capable datacenters. To quantify this, we built a [chip-by-chip model](https://semianalysis.com/accelerator-industry-model/) and forecast of the Liquid Cooling market, and [location-by-location tracker of future datacenter capacity](https://semianalysis.com/datacenter-industry-model/).

![](z-images/03f474d9857cbde7f48905b578dba310.webp)

Source: SemiAnalysis Datacenter Model

This report is a comprehensive primer on Datacenter cooling systems. In the first section, we explain the basic concepts underlying Datacenter cooling and introduce key equipment. The second part of the report focuses on current Hyperscaler self-build designs and explains their methodology to achieve best-in-class cooling efficiency - [informed by real-time imagery of their flagship AI Datacenters](https://semianalysis.com/datacenter-industry-model/).

![](z-images/1757df354897adf1c2982362aabcd5be.webp)

Source: SemiAnalysis Datacenter Model

We will also discuss the future of Datacenter cooling with Nvidia’s roadmap and that of its key customers. We’ll explain how each hyperscaler has adapted to market conditions and their considerable design shifts to adapt their infrastructure to the GenAI era. Each hyperscaler has taken a different approach and reviewing them has interesting supply chain implications. We will also discuss Oracle and Bytedance in Malaysia.

Finally, we’ll discuss key suppliers and the impact on their business. Nvidia’s massive ramp is causing shortages on components that on first glance look simple such as Quick Disconnects! While all firms will benefit from the underestimated Datacenter CapEx boom, there are relative winners and losers based on underlying design changes.

## Datacenter Cooling Basics

Thirty years ago, datacenter HVAC (Heating, Ventilation, Air Conditioning) resembled that of office buildings, reusing office or commercial style equipment with beefed-up AC (Air Conditioning) and/or AHUs (Air Handling Unit). But with modern datacenters generating >50x the amount of heat per square feet compared to an office and commonly requiring north of 30MW of power delivery to IT equipment (all converted into heat), the industry transitioned to much more specialized solutions. These sophisticated systems aim to maintain IT equipment at optimal temperatures – for example between 5°C and 30°C for the DGX H100. Operating outside this range would reduce equipment lifespan—which is economically unsound since servers and associated hardware represent the largest portion of a datacenter's total cost of ownership.

![](z-images/ed07d4a9efc25e428b58b2121993b9c2.webp)

Source: Nvidia

In today's datacenters, cooling systems represent the second-largest capital expense after electrical systems (excluding IT equipment). They've become perhaps the most critical design consideration due to their architectural variety and significant impact on operating expenses, particularly energy - the largest variable cost for a Cloud Service Provider (CSP). Electricity consumption related to non-IT equipment, of which the majority is cooling, is purely a non-productive expense which should be minimized – but there are tradeoffs.

![](z-images/b6318204cf069114313c715ffed6fe31.webp)

Source: SemiAnalysis Datacenter Model

## Cooling Systems and Energy Efficiency

The industry standard for comparing facility energy efficiency is the Power Usage Effectiveness (PUE) ratio, which divides total facility power by total IT power. A PUE of 1.5 means that for each Watt of IT load, the datacenter will consume an extra 0.5 Watts for cooling, power conversion losses and other minor items like lighting.

The industry average PUE, calculated by the Uptime Institute, is around 1.6. While many analysts and marketing charts take that number at face value, it is not representative of the industry – it is based on a survey that largely excludes hyperscalers and is a simple average of respondents with datacenters bigger than 4MW. Google and Meta both operate at around 1.1 PUE, and Microsoft and AWS around 1.15 PUE – we’ll explore later in the report how they achieve it.

![](z-images/865440a3be4a1adf5221e6b102f7c599.webp)

Source: Uptime Institute

It's important to note that PUE can be manipulated and doesn't always enable fair comparisons. For example, server fan power is generally included within IT load. This means that when comparing otherwise identical air-cooled and liquid-cooled server, the latter might show a higher PUE despite consuming less total power, due to lower server fan power. Alternative metrics have been proposed, but PUE remains the industry standard.

As a rule of thumb, non-IT electricity consumption typically breaks down as follows:

- 60-80%: Cooling system, primarily chillers, followed by fans and pumps.
- 15-30%: [Electrical system](https://semianalysis.com/2024/10/14/datacenter-anatomy-part-1-electrical/) - mainly UPS power conversion, power distribution losses and transformer inefficiency.
- 5-20%: Lighting and other - datacenters often include a small office area.

## Air-Cooled Datacenter Architecture

Let’s now explore common designs found in Colocation datacenters. The main cooling components are an indoor cooling unit for the data hall, chillers and cooling towards. In some cases the chiller and cooling tower may be integrated. These components work together through isolated liquid circuits to transfer heat efficiently.

![](z-images/dea79438f626d89f5f7e860f7d7d7e32.webp)

Source: Accuspeclnc

![](z-images/343155aff3563a0e9b3f404ac9d29565.webp)

Source: Mitsubishi Heavy Industries

In a datacenter, heat flows from the IT equipment to the outside environment in the following way:

- At the rack level, IT equipment generates heat, which is displaced via fans inside IT servers. This hot air is blown into the data hall.
- Indoors cooling units - commonly CRACs (“Computer Room Air Conditioner”) or CRAHs (“Compute Room Air Handler”) – remove heat from the data hall. Cold water (or another fluid) circulates inside the cooling coil of these units. Hot return air is blown over these coils, transferring its heat into the facility water, which is then pumped back to the chiller.

![](z-images/5078f1bd4c889967a11b49cc103b87d6.webp)

Source: MEPacademy

- The chiller performs a refrigeration cycle - an energy-intensive process to lower temperature. This involves transferring heat from water to a separate fluid called a “refrigerant”. The warmed-up refrigerant is compressed to further increase its temperature and flows through a heat exchanger called a condenser – either air-cooled with fans expelling heat onto the outside air or water-cooled with a separate cooling loop linked to a cooling tower. The refrigerant’s temperature drops in the condenser and returns much cooler. The cooling tower then finally exchanges heat from the condenser water into the outside environment.
- With heat removed from the data hall, the cycle starts again, with cooled water supplied to the indoors cooling unit. This continuous process requires varying amounts of energy and water, depending on system design.

![](z-images/ec30d44c3f41e6e8eb7ec655c99d015d.webp)

Source: Alpine Intel

Let’s now zoom into the individual components of cooling systems in each loop.

## Server Thermal Management and Airflow

The heat flow starts in the data hall, where IT Equipment generates heat as a direct byproduct of electrical power consumption—one kilowatt of electricity powering IT equipment produces approximately one kilowatt of heat. Chipmakers specify the maximum heat a chip or system can handle through its Thermal Design Power (TDP), which guides thermal engineers in designing appropriate cooling solutions. Over the past 5-10 years, chip TDP has shown a consistent upward trend. With AI accelerators, this trajectory continues to steepen, [with 1500W chips shipping next year](https://semianalysis.com/datacenter-industry-model/).

![](z-images/fec7526e7a884e6765d7967c10cd2e09.webp)

Source: SemiAnalysis

Starting from the chip, in an air-cooled server, a Thermal Interface Material (TIM) sits atop the die, conducting heat from the chip package itself to the heat spreader or heat sink.

![](z-images/5e8b62341dfb3e6c763409c5f71268ff.webp)

Source: TSMC

In air-cooled servers, a Thermal Interface Material (TIM) sits atop the die, conducting heat to the heat spreader or heat sink. Heat sinks increase surface area to reduce heat flux (heat per unit area), thereby improving cooling performance. Higher chip heat generation necessitates larger heat sinks, as exemplified by the oversized heat sink on the NVIDIA H100 (700W TDP). These oversized heat sinks are one reason why and Nvidia H100 server is typically 8 rack units (RUs), while a much lower power CPU server can fit within a 1U or 2U form factor.

![](z-images/84cf0b69e02e12be34e49bc6eb72d2b8.webp)

Source: SVA.de

Server fans evacuate the combined heat generated by internal components, with GPUs and CPUs contributing the largest portion for a typical H100 server. There must be sufficient airflow to remove heat from the heat sinks – an airflow of 165 to 170 cubic feet per minute (CFM) per kW of heat is a common rule of thumb that can be used.

![](z-images/d544d1c8c9104a49287cb8d01eff3a5f.webp)

Source: Gigabyte

Server fans can consume significant power, which led hyperscalers to design custom servers instead purchasing off-the-shelf solutions from vendors like Dell or Supermicro. Recent data from Nebius, a [Neocloud](https://semianalysis.com/2024/10/03/ai-neocloud-playbook-and-anatomy/) with hyperscale-level resources, demonstrates how custom server designs can reduce energy consumption.

![](z-images/0ebb2cd26e81103263e406e0f9f94a7e.webp)

Source: Nebius at OCP Global Summit 2024

The relationship between temperature and energy consumption is governed by **Delta T** —the difference between inlet temperature (entering the server) and outlet temperature. Delta T influences energy consumption in the following ways:

- In a cooling system, a higher temperature differential means that less airflow or pumping power is required to dissipate heat – the relationship is linear.
- Although the airflow required may vary linearly with delta T, the energy required to achieve a different airflow does not scale linearly. According to Fan Law physics, fan energy consumption equals fan speed cubed; a 10% reduction in fan speed (i.e. airflow) yields a 27% energy consumption reduction.
- Higher chip utilization rates prove more energy efficient, as increased heat generation creates a larger Delta T for outlet temperature relative to inlet temperature.

## Anatomy of an Energy-Inefficient Cooling System

Let’s now dig more into typical operating temperatures and their critical role in the design and efficiency of cooling system. The picture below shows how a traditional “inefficient” air-cooled Datacenter operates:

- Server inlet air at 22°C – the temperature at which air enters the server.
- Chilled water temperature at 7°C in the indoor cooling unit coils, rising to 13°C after heat absorption – a delta T of 6°C at the air handling unit.
- In most global locations, cooling water down to 7°C requires substantial electricity, primarily for the chiller's refrigeration cycle. Such a low chilled water temperature is inherited from office or commercial HVAC systems. The energy cost from chilling water to such a low temperature far exceeds savings from reduced server fan speeds.

![](z-images/fb137409c3cf5d3c3e2fea492024334f.webp)

Source: Supermicro at Hot Chips 2024

Over the past decade, datacenter operators have increasingly adopted higher inlet temperatures – well above 22°C, discovering that this approach doesn't actually compromise IT equipment longevity. The below table from ASHRAE, an American HVAC standards institute, shows recommends dry bulb (i.e. air) temperature between 18°C to 27°C for servers. However, going above 30°C is allowable and air temperature can even be set as high as 45°C in some cases – although the server class “A4” is more for military-like applications.

![](z-images/6925332f6a402de8412779301239eed1.webp)

Source = ASHRAE

Examining the Supermicro diagram raises an important question: Why does 7°C inlet water into the data hall air handling unit produce a 22°C server air inlet temperature )? This significant temperature gap often results from poor airflow management. Upsite Technologies developed the concept of the"Four Delta Ts" to deconstruct this gap into a few discrete Delta Ts across different areas of the data hall:

![](z-images/0bc4b00d3032f1296bdcd20c208f74cf.webp)

Source: Upsite

1. The temperature difference between server input air and return air.
2. Data Hall Air Turbulence/mixing Delta T from Air Turbulence/Mixing: A negative differential caused by hot return air mixing with cold supply air within the data hall.
3. Data Hall Air Handling Unit Delta T: temperature difference between the cooling coil’s inlet temperature and cool return air temperature after heat absorption.
4. Secondary Air Mixing Delta T: A positive differential caused by the cool return air mixing with hot exhaust air. Minimizing this differential ensures that inlet cold air maintains its temperature through efficient airflow management. Note that the image shows a Raised Floor, but this isn’t popular in Modern Datacenters due to limited cooling capacity (airflow) and cost.

To reduce “air mixing,” we use Containment systems to isolate air. The below image shows Hot Aisle containment, but Cold Aisle containment also exists and is in theory equally as efficient. Hot Aisle containment requires a specific ceiling design which is not suited for retrofits, while Cold Aisle containment makes maintenance harder (as the room is very warm), leading to some operators deploying it inefficiently. Modern greenfield datacenters generally use Hot Aisle Containment.

![](z-images/53c2d1821e86881b89b8ed5deeb2a910.webp)

Source: Smart Data Center Insights

Note that airflow management is complex and can be highly optimized through Computational Fluid Modeling (CFD), an analysis of physical properties like velocity, pressure, viscosity, density, temperature, etc. Sophisticated operators like hyperscalers rely heavily on CFD to reduce required airflow. These optimizations can have significant results - recall that Fan Law physics state that a reduction of airflow translates into a cubed reduction of energy consumption.

## Indoor Cooling Unit

The next item on our roadmap is the cooling unit used within the data hall. The most common options are CRAC (Computer Room Air Conditioner), CRAH (Computer Room Air Handler) and Fan Wall units. Direct Expansion (DX) units are an option but their use is far less common. Here are their key distinctions:

- A CRAC is a full Air Conditioner system that uses a refrigerant cycle (much like a home air conditioning system). It is a simple two-piece system, where each CRAC unit inside the room is paired with a condenser unit outside of the data hall. Cooling capacity (up to 100kW) and energy efficiency are low. This is popular in legacy or very small datacenters.

![](z-images/64b5cc9f82a0f94800bbd1966735a418.webp)

Source = Schneider Electric

- The main alternative is a “centralized” system where multiple “CRAH” units are linked to a central facility water. While a CRAC unit uses refrigerant to exchange heat from the unit to an outside cooling unit, a CRAH uses facility water to remove heat from the unit to either a chiller or a cooling tower. A larger piping and pumping system across the whole Datacenter is required when using CRAH units, but there are fewer moving parts in total and the economics are better for a large Datacenter.

![](z-images/d198e7e831bfdbc1df13f39b5aa8ddf2.webp)

Source: Schneider Electric

- Modern Datacenters use Fan Walls instead of CRAHs due to the higher capacity per unit of fan wall, typically 500-600kW. The form factor of a fan wall can be better suited to data hall designs as units can be stacked on top of each other to provide enough airflow for a full 5-10MW data hall. Fan walls also remove the need for a raised floor and perforated tiles to deliver cold air to the racks. While CRAH units intake hot return air from the top of the unit, a fan wall intakes hot air from the back of the unit – typically a mechanical corridor. The hot air from the data hall will travel through a ceiling into that corridor.

![](z-images/dea79438f626d89f5f7e860f7d7d7e32.webp)

Source = Accuspeclnc

CRAHs/CRACs/Fan Walls are typically set up with [N+1 or N+2 redundancy in a Tier 3 equivalent data center](https://semianalysis.com/2024/10/14/datacenter-anatomy-part-1-electrical/#datacenter-basics), but the pipes connecting the air handlers to facility water are typically in a 2N configuration to allow isolation for faults or maintenance.

Another indoor cooling unit that has seen its popularity increase is the Rear-Door Heat Exchanger (RDHx) – which conceptually can be thought of as an in-rack CRAH, despite many depicting this as “liquid cooling” for marketing purposes. An RDHx is a door placed on each rack with a radiator, in which cold water flows and absorbs the heat expelled by air-cooled servers. This partially or completely removes the need for room-level airflow management and cooling.

A rack using RDHx typically has a cooling capacity of 30-40kW – this can be increased to >50kW by adding fans to the rear door – referred to as an Active RDHx.

![](z-images/d2af0802f5b56003a5124438e0f8211c.webp)

Source: nVent

RDHx has gained popularity with increasing rack density, and we know of multiple Nvidia H100/H200 deployments using these systems, such as xAI’s massive cluster in Memphis, Tennessee – using RDHx combined with DLC.

![](z-images/2fd7a35529ea9b5f44118b47e5e71d83.webp)

Source: ServeTheHome

One of the advantages of RDHx is the physical proximity to the heat source, increasing Heat Exchanger effectiveness – the ratio of real heat transfer to maximal heat transfer. The ratio can be around 0.8 for an RDHx compared to 0.6-0.7 for room solutions like CRAH and Fan Wall. All else equal, this enables a slightly higher chiller inlet temperature i.e. lower chiller energy consumption.

The two main disadvantages are cost and fan power. Physically, one large fan is more efficient than multiple small fans, as airflow is proportional to the cube of the fan diameter. With the increased number of moving parts compared to central room solutions, CapEx is higher as well. In some cases – especially when only a portion of the room is cooled via RDHx – a Coolant Distribution Unit (CDU) is introduced to improve control over the liquid flow rate, temperature, pressure drop etc. This further increases the CapEx differential.

![](z-images/ca834f173b3be680ef36c147dc44188f.webp)

Source: Meta

A CDU is a simple system and its key components are a Liquid-to-Liquid Heat Exchanger, pumps, and control electronics. It exchanges heat between an inner cooling loop that connects to IT equipment and an outer cooling loop connected to the central facility water system and handles multiple racks. A CDU typical has a capacity greater than 1MW – but there are many variants which we’ll explore later in the report when discussing DLC.

![](z-images/de9913ed0d52a4f343523f54755c0d92.webp)

Source: Dafnia

## Air-Cooled and Water-Cooled Chillers

Let’s now discuss chillers, typically the single most energy-intensive component of a Datacenter (excluding IT Equipment). A chiller is essentially a large-scale refrigerator, performing the full refrigeration cycle. The key to any refrigeration cycle is the compressor. Two physical phenomena are at play here:

1. Vapor can absorb more heat than liquid
2. Temperature and pressure have a linear relationship in a closed system, i.e. the higher the pressure, the higher the temperature. A chiller’s refrigeration cycle works as follows:
	- Inside a chiller flows a “refrigerant”: a specific fluid (e.g., R134a or R123ze) with a much lower boiling point than water, to take advantage of the 1st property (vapor absorbs more heat than liquid).
		- A chiller has two heat exchangers, the “evaporator” and the “condenser”. In the evaporator, the fluid refrigerant absorbs heat from the indoors cooling unit and evaporates, turns into gas/vapor.
		- The refrigerant in vapor form then goes through a compressor, significantly increasing pressure and temperature. The hotter the refrigerant, the greater its capacity to transfer heat.
		- In the condenser, the high-pressure and high temperature refrigerant transfers heat to a separate medium – typically air (i.e. air-cooled chiller) or water – the latter involves a separate cooling loop with a cooling tower.
		- An expansion valve reduces pressure and thereby temperature – the refrigerant returns to a liquid state at a very low temperature.

![](z-images/320f2facd0bed257ae4ded03f8bd61bf.webp)

Source: District Heating and Cooling Systems

The compressor is the key component, and its performance directly impacts cooling capacity - increasing the refrigerant's temperature before it enters the condenser requires more compressor energy (higher pressure).

Now, let's explore the two primary types of chillers used in data centers: air-cooled and water-cooled, starting with the latter. The fundamental difference between the two lies in the condenser and how heat is rejected from the system.

A water-cooled chiller is a large unit typically sitting inside the premises in a dedicated room, called the Mechanical Room, alongside large pumps. Its Condenser unit is a Liquid-to-Liquid tube heat exchanger, transferring heat from the refrigerant to a separate cooling circuit. The latter is connected to cooling tower located outside the premises – on the roof or next to the building.

![](z-images/231f320f9310653f9d93942f7fd068da.webp)

Source = Mitsubishi Heavy Industries

One convenient feature of water-cooled chillers (centrifugal type in particular) is their large cooling capacity: Chiller capacity is usually measured in Refrigerant Tons (RT, one RT = 12,000 British Thermal Units per Hour or 3.517 kW). In large datacenters, it is common to see chillers with a capacity of 15MW (~4250 RT) or even up to 20MW per unit! Thus, just a few chiller units are required to cool a large facility, and they generally sit in the same mechanical room. On the flip side, consolidating cooling within a few large chillers requires larger piping across the Datacenter.

These units are typically quite energy-efficient, with a Coefficient of Performance (COP = chiller energy requirement divided by cooling capacity) around 7x, depending on outdoors conditions and Delta T (it can vary a lot).

Given their size, these units lack operational flexibility—frequent cycling on and off proves highly inefficient, even when external conditions might permit operation without mechanical cooling. This is why Variable Frequency Drives have been increasingly popular. Variable Frequency Drivers are a power electronics system converting AC to DC and then DC back to AC via a programmable inverter, allowing precise control over the voltage supplied to the chiller motor as well as enabling precise adjustment of the water flow rate pumped back to the data halls.

![](z-images/fda16e5ce04f9b1e7ebaf3e11be5365e.webp)

Source: YORK

A water-cooled chiller works in tandem with cooling towers, of which there are two main types: dry and wet. The latter, also known as Evaporation Towers, are open-loop systems spraying water from the condenser loop into a specific material (a “fill”). Cooling capacity is increased through evaporation, but water consumption is substantial, and a dedicated water treatment plant is typically required.

![](z-images/5a780bf2e6fa878fe23cd9f90bba1add.webp)

Source: The Engineering Mindset

Water evaporation enables a drop in temperature from dry bulb to wet bulb as heat energy is absorbed in order to affect the water’s phase change to a vapor. This reduces– the load on the chiller’s compressor. As per the below chart, the magnitude of the temperature reduction has an inverse relationship with humidity. Cooling towers perform best in arid regions, like Arizona, while warm and humid locations like Singapore prove more challenging.

![](z-images/04d4cd09aff23859747c1b739de29333.webp)

Source: Ariel’s Checklist

A single datacenter evaporation tower can typically cool ~7-8MW for large units – with common flow rates around 5,000 GPM (gallons per minute).

![](z-images/7c7cacf5e71122d2c7c2e9313c81ef21.webp)

Source: SemiAnalysis Datacenter Model

Tesla is building even bigger towers in its [Giga Austin datacenter](https://semianalysis.com/datacenter-industry-model/), where each tower is a one-to-one match with a chiller and can cool north of 10MW!

![](z-images/590d0228e903fe0dad7cb409bcb31804.webp)

Source: Brad Sloan

An alternative to the evaporation tower is to use a dry cooling tower (or “dry cooler”). This is known as a closed-loop system (i.e. no water loss) with the water flowing through a coil and cooled by a fan. This does not benefit from the lower Wet Bulb temperature, but doesn’t consume water, which is cheap but can be scarce and may involves permits and face local protests and political issues. The largest units can cool up to 2MW but require more than 20 fans.

![](z-images/53366cea179c01a6926c4ae53292fd22.webp)

Source: The Engineering Mindset

## Water Usage, Air Cooled Chillers and Dry Coolers

The main issue with Wet Cooling towers is the elevated water usage, which delays projects in water-constrained locations or datacenter-heavy areas (such as “Data Center Alley” in Ashburn, Northern Virginia). A metric commonly used is the WUE ratio (Water Usage Effectiveness), expressed in Liters per kWh – simply put, how many liters are needed for each kWh of energy. The below report from the US Department of Energy provides some good estimates – a large-scale datacenter with a water-cooled chiller system can have a WUE north of 2L/kWh.

- For a 50MW Datacenter operating at 60% utilization and a PUE of 1.25, a 2.0 WUE means 657M liters of water per year (174M gallons of water per year).
- Note that we will discuss below what airside and waterside economizers are.

![](z-images/d5b8a3b576b217fdc1a207156a363507.webp)

Source: US Department of Energy

Air-cooled chillers have gained significant traction over the last few years due to their better energy efficiency and amid rising water constraints. A system based on air-cooled chillers is simpler compared to water-cooled alternatives, as the chiller is located outdoors and acts both as a chiller and cooling tower – with fans blowing air onto the condenser to evacuate heat. Modern systems integrate various sensors and controls, as well as a VFD, to automatically adjust the power of the compressor, or turn it off, if the outside air is cold enough.

This QTS datacenter (48MW of IT Capacity) has multiple air-cooled chillers on the roof –this is a common design among large 3 <sup>rd</sup> party operators such as NTT or Digital Realty.

![](z-images/f31856525449ab53dfaddc9537a4c42e.webp)

Source = Google Earth

Air-cooled chillers can also be placed on the ground, next to the datacenter. In Memphis, xAI actually deployed both open-loop cooling towers (likely with water-cooled chillers inside the premises) and air-cooled chillers outside!

![](z-images/6554249103c46f42e129001cdbbcc22f.webp)

Source: SemiAnalysis Datacenter Model

These units have a lower capacity and are less efficient than water-cooled chillers: the below example from the Schneider catalogue shows the specs of a modern air-cooled chiller. The largest SKU has 18 fans and can cool up to 2MW – and that unit requires 500kW of power, or a 4x energy efficiency ratio, when the outside air is 35°C, input water is 20°C and return water is at 30°C.

![](z-images/f491323f027d0162b153803084fa2721.webp)

Source = Schneider

To increase energy efficiency of air-cooled chillers and dry coolers, an option that has largely risen in popularity is adiabatic cooling. It involves adding a layer called “pre-cooling pad”: water is sprayed on the cooling pad, and subsequently evaporates, extracting heat from the surrounding air, thereby reducing ambient temperature (wet bulb vs dry bulb) and increasing efficiency of the system. This enables a reduction in compressor power for an air-cooled chiller. The adiabatic spray can be turned off as well if the ambient temperature is cool enough, or if there is a high humidity level reducing its efficiency.

![](z-images/9d43d68837d299628dbdfe007e387a14.webp)

Source = SPX Cooling

Lastly, let’s briefly discuss the concept of Heat Reuse. On paper, the solution is very attractive – it involves transferring heat to a third party (i.e. a nearby city, for example), thereby significantly reducing the cooling requirements, and potentially monetizing heat. Hyperscale datacenters could theoretically serve tens of thousands of households! According to Microsoft, the Energy Reuse Factor (reused energy / datacenter electrical energy) could be up to 69% in the winter and 86% in the summer.

![](z-images/eba603c4bf5251b5ce8e0d1abe81e9af.webp)

Source: Microsoft

The concept is popular in Europe, and a few datacenters already operate such systems – with Equinix famously powering the 2024 Olympics swimming pool in Paris with a nearby datacenter. Some countries like Germany are pushing this on a regulatory level to meet their sustainability goals.

The diagram below depicts Nebius’ system in Finland near Manstala:

- Heat generated by servers inside the datacenter goes through a heat exchanger and into a central Heating station – typically operated by city officials.
- If more heat is needed, the station will use its own HVAC system such as Heat Pumps to further increase temperature.
- Heat can then be delivered to households.

![](z-images/479d7c6edced3e97580ee7b8694ab987.webp)

Source: Nebius

While attractive on paper, there are many practical limitations such as proximity to households and availability of required infrastructure.

## A Look at Hyperscaler Designs and Their Ultra-Low-PUE Systems

Hyperscalers generally deploy standardized datacenter designs to increase time-to-market, facilitate logistics and reduce costs. Unlike colocation providers who must build designs that meet a broad set of current requirements and possible future requirements from diverse customers, as a sole tenant, Hyperscalers can create efficient designs that cater to specific internal workloads. These datacenters can achieve PUEs generally between 1.1 and 1.2 – mostly through a combination of “Free Cooling” techniques, higher IT equipment operating temperature, and deep CFD analysis.

Before showing actual deployments, let’s discuss some basic concepts. “Free Cooling” or “Economizer” are techniques using the outside environment to cool a datacenter. There are two main techniques, each with multiple variants:

- Airside economizer: Using exterior air to cool the datacenter – this is particularly well suited to areas with a cold climate – eliminating the need for a chiller. This technique can be enhanced with water spraying at the cooling tower.
- Waterside Economizer: For datacenters that do use chillers, a secondary liquid loop that bypasses the chiller’s refrigerant loop. Water goes directly to the cooling tower or dry cooler – but this requires the water temperature to be above the outdoors wet bulb temperature.

![](z-images/d88523d605ea3bb0141f89bdd4839ef5.webp)

Source: US Department of Energy

Both techniques only work if the datacenter is in a location with a cold enough outside environment relative to the inlet temperature. The colder the environment, and the hotter the inlet temperature, the better. Hyperscalers play on both sides of the equation. To maximize their use of Free Cooling, they typically operate their servers at above 30°C inlet temperature, even sometimes above 40°C. Their custom server designs can handle this high temperature without degrading performance and life expectancy.

Geography is of course a crucial factor at play. We show below Microsoft’s breakdown of PUE and WUE per Datacenter geography. The worst-case scenario for the use of Free Cooling is a warm and humid climate like Singapore or India.

![](z-images/41086847a212cb11caabc95c15f16ad8.webp)

Source: Microsoft

## Microsoft Datacenters and Cooling Systems

Let’s now look at their actual designs, starting with Microsoft - below is the evolution of their reference design, with the [48MW “Ballard” still being deployed everywhere](https://semianalysis.com/datacenter-industry-model/).

![](z-images/1ba943c91f785cd87c99935eba3143f4.webp)

Source: Microsoft

Ballard is designed for air-cooling and bypasses the use of chillers. Microsoft uses a system they call “Direct Evaporative Cooling”, shown below. This corresponds to an airside economizer system:

- Exterior Air is filtered and pulled inside the facility with fans.
- If needed, the air will be humidified to lower its temperature.
- Air enters the server room, is warmed up, channeled into the hot aisle, and directed out of the facility via exhaust fans.

![](z-images/b2f95874a34c181ca6c321eb6d4dafa6.webp)

Source: Microsoft

Microsoft calls this system “Free Air Cooling” when no water evaporation is needed.

![](z-images/7331b479a409061c7c3e34e3215250e8.webp)

Source: Microsoft

We show below an aerial view of the hot air exhaust system, and the filters letting the outside air get in.

![](z-images/d50a740157c78d889b2a6a62ad3acff0.webp)

![](z-images/d06c898adf63fce340c44c503798250f.webp)

Source: Google Earth, SemiAnalysis

This system design avoids the need to use chillers and air-water heat exchangers like CRAHs. The upshot is that with no need to design in air-cooled chillers/dry coolers or cooling towers, the datacenter can have a meaningfully lower CapEx/MW. This system is completely dry – and this specific Datacenter is located near Phoenix, Arizona. While >30°C temperatures are common, the climate in Phoenix is very dry – and the wet bulb temperature can be significantly lower than dry bulb temperature. The drawback is that water evaporation is needed for a large portion of the year, leading Microsoft to post a >2 WUE ratio in Phoenix, despite a company average of 0.3 WUE.

![](z-images/4cc2be6c3032f53f1a9b32db9cccd8ff.webp)

![](z-images/1ba99d517041de98da5cb3c4d7724c88.webp)

Source: Bing Maps and Google Earth

Note in the image above, a complete lack of any cooling towers anywhere on this facility, as this datacenter uses Free Cooling.

![](z-images/f06262fc825e818adaec70a2dc0c77a1.webp)

In some areas, climate conditions are not suited to this type of cooling, and Microsoft uses another system called “Indirect Evaporative Cooling” – still without any mechanical cooling but using a dry cooler placed outside.

![](z-images/d5bcb1ece5f34e5865adf4b44c14297e.webp)

Source: Microsoft

Below is a satellite view of this system in an Iowa datacenter. Note the fluid cooler and AHU located just outside the facility.

![](z-images/dff89bacaf0140a5ffe7994763bd447c.webp)

Source: Google Earth

## Meta’s “H”: Efficiency Over Time-to-market

Meta’s famous “H” design is another interesting case study. Through a combination of Free Cooling and high server inlet temperature, as well as relatively low power density, Meta has been operating datacenters at best-in-class efficiency levels for over a decade. The diagram below depicts their cooling system: it is very similar to Microsoft’s “Direct Evaporative Cooling” and “Direct Free Cooling”.

![](z-images/997f3b7dc6b575a8fcb45dd5aeffcb5b.webp)

Source: Electronics Cooling

In some climates, Meta adds CRACs to cool down the exterior air in the warmest summer days – in which PUE is likely significantly higher than their company average 1.08.

![](z-images/ea897d08301a48dc7fbacea9cf424f87.webp)

Source: Google Earth

In 2018, Meta introduced a variation to enable Free Cooling in climates with higher levels of humidity – such as Singapore. It relies on an air-to-water heat exchanger, with outside air cooling the facility water system, and can be further cooled down with an adiabatic option.

![](z-images/6380946a89d00b42710ef42414c147ca.webp)

![](z-images/4ce5bc16789907b15816795d098d3aa3.webp)

![](z-images/783fbb38f69537ecb843f0887623a30b.webp)

Source: Meta

Meta’s efficiency levels are impressive (PUE at 1.08 and WUE at 0.20), but this is achieved through a complex, three-level structure. Meta’s “H” is much bigger than competitor’s designs, for a similar or lower power capacity – enabling fans to run at lower speed. [Our real-time and historical satellite imagery reveals that time to complete a shell is typically ~2 years, 2-3x longer than other hyperscalers](https://semianalysis.com/datacenter-industry-model/). Low density and high time-to-market are suboptimal in the AI era, which led [Meta to take the drastic step of scrapping a number of “H”s under construction to replace it with their new AI-ready design](https://semianalysis.com/2024/10/14/datacenter-anatomy-part-1-electrical/#meta-datacenter-scrapped-vertiv-schneider-electric-eaton-legrand-delta-datacenter-bill-of-materials-by-component-transformers-switchgear-redundancy-ups-ocp-busbar-generators-substation) (explored behind paywall).

![](z-images/452f6075c8d762d50400ceed0fdd9b9a.webp)

Source: Google Earth

## Google Datacenters – Energy for Water Tradeoff

Google’s reference design is very different – while their PUE is best-in-class at 1.10, their use of water is much more extensive with a WUE above 1.0. Google uses a waterside economizer, which typically involve using two separate facility cooling loops – a “chiller” loop performing the refrigeration cycle, and a “heat exchanger loop” with no mechanical cooling. When outside conditions allow it, the datacenter uses only the secondary loop, with water going directly to a cooling tower or dry cooler, bypassing the chiller.

![](z-images/5a6d0ed2df2ecd88fef9f89fc42299d1.webp)

Source: Schneider Electric

A plate heat exchanger is a system where two fluid loops circulate and exchange heat. Such units are typically quite efficient in terms of Heat Transfer – as a rule of thumb, a loss of 2-3°C is typical, i.e. water coming at 30°C from cooling tower would lose 2°C and transfer 28°C into the indoor cooling unit.

![](z-images/6d3a5cff87c835dd0bee7c8eddb6a125.webp)

![](z-images/81643ad5cb3ec97c0ebb2e8d7b12766e.webp)

Source: Alfa Laval

Google has deployed various types of cooling systems – of which the most impressive is a [Finnish datacenter using sea water](https://www.youtube.com/watch?v=3f0V6_ZFHMk) free cooling, but its most common design relies heavily on evaporative cooling towers. In the below example, three large Data Centers with an IT load of ~200MW share the same centralized cooling infrastructure (we can see the piping), with giant fans on top of the cooling towers. These towers are large two-cell per water-cooled chiller unit, meaning that 28 cells can cool 200MW, or ~7MW per cell. Some designs include water-cooled chillers, but other datacenters are completely “chillerless” – Google has publicly said that their large Belgium campus is chillerless.

![](z-images/c9cfcfbf5de91081841ace29b2aa1c6e.webp)

Source: SemiAnalysis Datacenter Model

Lastly, let’s briefly look at AWS Datacenters. The company is less transparent and we have less available information. We show below a campus in Manassas, of which the largest individual building has a critical IT power of 50MW.

![](z-images/6add2e976f436fdfb10a8c86999ece01.webp)

Source: SemiAnalysis Datacenter Model

We note that there is no apparent outdoors cooling unit (aircooled chiller, dry cooler or cooling tower). We believe that AWS relies on a system very similar to that of Microsoft and Meta – with the exhaust fans on the roof, and louvers to let the exterior air in.

![](z-images/31bb455981f566776c1434554f12ca9d.webp)

![](z-images/3ea0aa5d73c5d60eceb27795ad539883.webp)

Source: Amazon

We have now covered the basics of Datacenter cooling system. Hyperscalers have largely proved wrong the popular narrative that air cooling is not an energy efficient technology. The rise of GenAI changes everything about this framework and challenges existing designs.

Let’s now discuss Nvidia’s roadmap and the near-term and long-term future of Datacenter design, and impact equipment suppliers. We believe that the real drivers behind liquid cooling adoption are still misunderstood, and so is the future of cooling systems for inference vs training datacenters. We’ve often heard that Liquid Cooling adoption is driven by superior energy efficiency, or because cooling >1000W chips with air is not possible. We also commonly hear that Inference will require low-power servers and air cooling.
