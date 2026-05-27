---
title: "lessons learned from scaling chromium on bare metal"
source: "https://x.com/usekernel/article/2059319616556683387"
author:
  - "[[KERNEL (@usekernel)]]"
published: 2026-05-26
created: 2026-05-26
description: "by rafael garciai previously was cto of clever. part of my job as cto was managing our aws bill. and in the back of my mind, i always though..."
tags:
  - "clippings"
---
![Image](https://pbs.twimg.com/media/HJNXbVabEAAy4-6?format=jpg&name=large)

by rafael garcia

i previously was cto of [clever](https://www.clever.com/). part of my job as cto was managing our aws bill. and in the back of my mind, i always thought: man, if there were some escape from the death grip that aws had on us, i’d jump on that. because once you have a big enough aws bill, there really aren’t huge levers you can pull. you can probably pull some levers that give you 10, 20, maybe even 30% savings. but 90%? no chance.

that feeling never really went away. so when we started kernel and i found myself staring at another compute‑heavy workload (chromium) it was déjà vu. the second time around, i was even more convinced it shouldn’t be this expensive or inefficient, so i started exploring a bunch of ways we could run thousands of chromium instances on bare metal.

**first attempt: docker containers (no k8s)**

the first thing we did was the obvious thing: run chromium in docker and keep a warm pool. at the beginning, when there were maybe fewer than ten users playing with the api, this was fine. it was the easiest way to get something working and see what people actually wanted from “cloud browsers.”

but as you can imagine, running hundreds of hot chromium containers that are just sitting there waiting to be used is expensive. on top of that, it became clear from early design partners that many use cases required that these chromium instances run for a very long period of time. sometimes even for a couple days. sometimes even indefinitely. this only multiplies the cost of running warm pools. not to mention, containers share the host kernel by design. a single container escape means host access and full tenant exposure.

**second attempt: (unikraft) unikernels**

in parallel, i’d been tinkering with [unikernels](http://unikernel.org/). unikernels seemed to promise it all. at least in the pure form, you get: one process, single address space, app linked directly with a minimal kernel. in theory, you get tiny images, fast boot, and less overhead.​ almost perfect for our use case. the obvious mismatch is that chromium is far from a single‑process program. it spins up multiple processes and on top of that we run additional services alongside it. still, the combination of strong isolation and millisecond-level cold starts was intriguing. more importantly, this approach would let us leverage memory snapshots, allowing us to capture the entire in-ram state of a running browser instance and save it to disk. this would make it extremely cost-efficient to maintain instances over long periods of time.

i wanted to make this work, so i started talking to the [unikraft](https://unikraft.org/) folks to see how far we could bend things. what we ended up with is something that stretches the strict definition of “unikernel,” but works extremely well in practice. unikraft, the unikernel development kit, is more or less a fork of firecracker that follows the principles of unikernels. the important part is that it lets you run multi-process general purpose workloads while keeping all the isolation and performance benefits of unikernel. with their help, we put [chromium on a unikernel](https://github.com/onkernel/kernel-images).

the way it works today is: when we spin up a browser, we pay the full cost of starting chromium (think 5-10 seconds), and then we immediately put it into [standby](https://www.kernel.sh/docs/browsers/standby), basically snapshot ram and save it to disk. from the outside, it feels like we have a huge warm pool of browsers ready to go. under the hood, most of them are ram snapshots sitting on disk, not consuming cpu or memory. when a request comes in, we read that snapshot off nvme, wire it up to the network, and hand it back to you. the request is effectively decoupled from the cost of starting chromium. and nvme is fast enough that this takes on the order of 30 ms.

on top of that, this enables us to not charge you for idle time. instead we put your browser vm into standby if the cdp connection goes idle. the trick is to not break the connection. to handle that, we built an ingress proxy layer that holds onto the cdp connection while the vm is asleep. the vm disappears, the proxy doesn’t. when we wake the vm back up, it resumes with the same state, the same cdp connection, and from your point of view nothing weird happened. this is super useful when you're waiting on an llm response to take further action or waiting for a human-in-the-loop step.

at this point, we had strong isolation, super fast cold starts, and memory snapshots, so we’re done, right? unfortunately, unikraft was almost the perfect solution for us, but it’s missing live vm migrations and device passthrough (for gpu support). vm migrations is on unikraft’s roadmap, but it’s not something we can treat as a solved problem today. the result is that these memory snapshots we rely on are effectively pinned to a specific host. that’s not great. if the host dies, the disk fails, or power disappears mid-session, the state goes with it. that's completely at odds with what users expect from a browser. getting device passthrough was going to be even trickier. as mentioned earlier, unikraft is a fork of firecracker, and that hits a hard ceiling for gpu support. it has no device passthrough at all and [explicitly has no plans on supporting it](https://github.com/firecracker-microvm/firecracker/issues/849).

**third attempt: hypeman (qemu)**

to get gpu support and live vm migrations, we had to build a brand new data plane while preserving the strong isolation, fast cold starts, and memory snapshots of the previous implementation. the question then became which virtualization technology to use. the options came down to two: cloud hypervisor, qemu. we started with cloud hypervisor, but found the ecosystem and our early experiments with vgpus didn’t get us as far as qemu.

today, our [gpu-accelerated browsers](https://www.kernel.sh/docs/browsers/gpu-acceleration) run on a qemu-based data plane. we open sourced this data plane and called it [hypeman](https://github.com/kernel/hypeman). this allows us to do a bunch of cool things like get 60 fps (6x faster than our previous implementation), and, most importantly, [play doom, compiled to wasm, on our cloud browsers](https://www.youtube.com/watch?v=4DbWQyxZ3MA).

**probably don’t do as i do**

at clever, the ceiling on efficiency was essentially fixed. infrastructure was something we consumed, not something we could fundamentally change ourselves. for many teams, letting someone else handle it is the right move. but for us, it turned out to be almost always better to own more and more of our infrastructure stack. that ownership has really started to pay off in how much performance and efficiency we have been able to squeeze out.