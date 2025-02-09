<p align="center">
  <img src="https://github.com/mkturkcan/congestionpricing/blob/main/assets/title.png?raw=true"  width="1200" />
</p>

# NYC Congestion Pricing: A Vision-Based Analysis

Using a computer vision framework applied to a network of 910 NYC traffic cameras, we analyze traffic patterns before and after the implementation of congestion pricing on January 5, 2025. Our visualization depicts relative traffic volume changes at key intersections throughout Manhattan, with circle diameter representing magnitude of change and color indicating direction (green for reduction, red for increase).

## Interactive Visualizations

- [Weekday Traffic Analysis](weekday.html)
- [Weekend Traffic Analysis](weekend.html)

## Abstract

We examine the impact of New York City's congestion pricing program through automated analysis of traffic camera data. Our computer vision pipeline processes footage from over 900 cameras distributed throughout Manhattan, comparing traffic patterns from November 2024 through the program's implementation in January 2025. By excluding anomalous periods such as holidays, we establish baseline traffic patterns and identify systematic changes in vehicle density across the monitored region. Our preliminary findings indicate substantial shifts in traffic distribution, including notable reductions in entry points to the congestion zone and unexpected traffic pattern changes in residential areas such as the Upper East Side. This ongoing research project will provide regular updates to track long-term evolution of urban mobility patterns in response to the pricing policy.

## Key Features

- Analysis of 910+ traffic cameras across Manhattan
- Comparison of pre- and post-implementation traffic patterns
- Automated computer vision pipeline for traffic density analysis
- Visualization of traffic pattern changes at key intersections

## Current Limitations

1. The computer vision system includes stationary vehicles in traffic density calculations, which may affect measurements in areas with high street parking density
2. The baseline comparison period (starting mid-November) provides limited seasonal context
3. The current implementation analyzes aggregate traffic flow without distinguishing between individual lanes or travel directions
4. Camera-based instantaneous vehicle counts serve as a proxy measure and may not directly correlate with actual transit times or congestion levels

## Research Team

- [Mehmet Kerem Turkcan](https://keremturkcan.com)
- [Jhonatan Tavori](https://www.cs.tau.ac.il/~jhonatant/)
- [Javad Ghaderi](https://www.ee.columbia.edu/~jghaderi/)
- [Gil Zussman](https://wimnet.ee.columbia.edu/people/gil-zussman/)
- [Zoran Kostic](https://www.aidl.ee.columbia.edu/)
- [Andrew Smyth](https://www.columbia.edu/cu/civileng/smyth/index.html)

*Columbia University*

## Partner Organizations

- [Columbia University](https://www.columbia.edu)
- [Center for Smart Streetscapes](https://cs3-erc.org)
- [COSMOS Lab](https://www.cosmos-lab.org/)
- [Urban Hybrid Twin](https://digitaltwin.engineering.columbia.edu/)

## Related Links

- [The most detailed view of NYC traffic (so far)](https://www.mta.info/article/most-detailed-view-of-nyc-traffic-so-far)
- [2025 Kicks Off Right: Cordon-Based Congestion Pricing Implemented in New York City](https://inrix.com/blog/2025-kicks-off-right-cordon-based-congestion-pricing-implemented-in-new-york-city/)
- [New York says 1 million fewer vehicles have entered Manhattan since congestion pricing start](https://www.msn.com/en-us/urban-infrastructure/transportation-infrastructure/new-york-says-1-million-fewer-vehicles-have-entered-manhattan-since-congestion-pricing-start/ar-AA1y5eBF)
- [Congestion Pricing Tracker](https://www.congestion-pricing-tracker.com/)

## Acknowledgments

This website template was adapted from the [Academic Project Page Template](https://github.com/eliahuhorwitz/Academic-project-page-template), which was based on the [Nerfies](https://nerfies.github.io) project page.