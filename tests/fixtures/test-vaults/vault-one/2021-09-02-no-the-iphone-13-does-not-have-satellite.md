---
title: "No, The iPhone 13 Does Not Have Satellite Internet | Band n53 & Globalstar (GSAT) Explained"
date: "2021-09-02T20:29:57.304Z"
url: "https://newsletter.semianalysis.com/p/no-the-iphone-13-does-not-have-satellite"
author: "Dylan Patel"
description: "Recently rumors cropped up that the iPhone 13 would support Satellite internet."
---

Recently rumors cropped up that the iPhone 13 would support Satellite internet. The internet and Apple fan world went into frenzy with all sorts of speculations and tech media publishing many articles. Globalstar, a satellite services business, had their shares soar 90% from mid-August lows. SemiAnalysis is tired of hearing ridiculous fandom regarding satellite capabilities on the next iPhone, so we are going to lay out the technical details.

The source of this rumor is from Ming Chi Kuo, the best Apple supply chain analyst, but others have spun it out of control. The iPhone 13’s modem will support the n53 band. This is nothing by itself. The 3GPP, the standards board for 5G and other telecommunication standards has made it part of the evolving 5G standard. The 3GPP addition of this n53 band (11.25MHz of spectrum 2483.5MHz to 2495MHz) is not for explicit satellite connections, but because Globalstar is targeting it for terrestrial usage.

![](z-images/55a52c1b4e38b74eacd06d5eb0fc1a17.webp)

As such, Qualcomm has implemented it in their next generation modems. Apple is supplied with modems from Qualcomm, and while they do not necessarily use the commercially available modems from Qualcomm, they do get custom versions which follow along the same roadmaps. The iPhone being supplied with a modem that supports this band is nothing special in of itself. 2.4GHz WiFi routers for decades have been able to use this band with mild modifications due to the proximity of their operating spectrum. This spectrum is rife with interference already, with WiFi and Bluetooth operating outside their normal bounds and microwave leakage.

![](z-images/6875d52cbe2ab0994d03e3e7072b34fe.webp)

Just because a modem and even RF front end support the n53 band, does not necessarily mean that it can now connect to anything broadcasting in this frequency. Transmitting this signal to the phone and having the phone’s antennas pick it up is very difficult. For phones to connect to satellites natively and reliably, the satellites must massively increase transmit power and sensitivity. This isn’t possible for Globalstar as they have not launched any new satellites for a while and have no current plans to do so.

The other option is that the phones must have significantly higher gain antennas. RF antenna design is evolving, but to fit this type of antenna into a smartphone package is not in the cards currently. It’s possible to go part of the way there while satisfying phone constraints, but the design will not be reliable enough for constant connectivity. [Bloomberg indicates that the service and connectivity is incredibly unreliable.](https://www.bloomberg.com/news/articles/2021-08-30/apple-plans-to-add-satellite-features-to-iphones-for-emergencies)

> Apple has created a mechanism that will ask users to be outdoors and walk in a certain direction to help the iPhone connect to a satellite. Linking to a network also won’t always be instantaneous, with testing of the feature indicating that it could sometimes take up to one minute to work.

The most likely path forward, and the one that Globalstar proclaims themselves, is licensing this spectrum for use on a terrestrial basis. They have achieved approval for terrestrial services from the US FCC and other regulators around the world. If Globalstar strikes a deal with a major carrier, then they can add this n53 band to their existing infrastructure. Some modifications of equipment at many towers and small cells would be required, but it would function the same as any other sub 6GHz band that your cell phone currently uses. They are also targeting private network deployments utilizing this spectrum.

![](z-images/0a96b675dcabefb40cb548a6f882aaf8.webp)

Globalstar believes that over half their revenue will come from terrestrial spectrum licencing. This “satellite company” is really just a wireless spectrum distributor and arbitrager. Their satellite infrastructure is only a minority of their future revenue projections. There is still a possibility that Apple does a deal with Globalstar, but it is not factored into their future revenue. The smoking gun for the iPhone 13 not utilizing Globalstar satellites is the satellites themselves.

![](z-images/0988aa0daf963606591a29c1dcd97cd9.webp)

Globalstar’s launches of satellites was in 2010 to 2013. Their network was completed and has a 15-year design life. This means they are not designed to last beyond 2025 to 2028. There is a possibility they will last longer of course, but Globalstar has no plans to launch more satellites. Furthermore, these current satellites are not capable of much.

![](z-images/aae75148d3187e1c0363e40707cc764d.webp)

As per GlobalStar, they are capable of up to 256kbps (32Kbps). This is with optimal, unobstructed conditions and high power and gain antennas. Even in the perfect world where this RF subsystem is miniaturized to fit on a smartphone, this is nowhere near enough for using the modern internet. We linked a Bloomberg article above. Just from opening it and scrolling through to read it, it downloaded 10.4MB of data. This is without having played the embedded videos. A simple article would take 5 minutes and 25 seconds to download in perfect conditions.

![](z-images/198942eb40a023195d3af5d031492c99.webp)

Anyone who has experience with RF, knows peak capabilities are not typically or ever reached. This 256kbps is an incredibly optimistic reading. Furthermore, the fact Globalstar’s satellite network is close the end of its useful life. Their long term revenue projections are mostly attributed to licensing their n53 band for terrestrial service. It is very clear that Apple is working on satellite internet capabilities in the long term, but this will not be from Globalstar’s current satellites. The recent meteoric rise in Globalstar's stock price is almost entirely unwarranted.

_This article was originally published on [SemiAnalysis](https://semianalysis.com/no-the-iphone-13-does-not-have-satellite-internet-band-n53-globalstar-gsat-explained/) on September 2nd 2021._

_Clients and employees of SemiAnalysis may hold positions in companies referenced in this article_.
