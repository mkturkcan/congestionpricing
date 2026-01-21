<p align="center">
  <img src="https://github.com/mkturkcan/congestionpricing/blob/master/static/images/title.png?raw=true"  width="1200" />
</p>

# NYC Congestion Pricing: A Vision-Based Analysis

Using a computer vision framework applied to a network of 910 NYC traffic cameras, we analyze traffic patterns using year-to-year data from November 14 to January 4 (before and after) to look at the effects of the pricing. Our visualization depicts relative traffic volume changes at key intersections throughout Manhattan, with circle diameter representing magnitude of change and color indicating direction (green for reduction, red for increase).

## Interactive Visualizations

- [Interactive Visualization](interactive/index.html)

## Abstract

We examine the impact of New York City's congestion pricing program through automated analysis of traffic camera data. Our computer vision pipeline processes footage from over 900 cameras distributed throughout Manhattan and New York, comparing traffic patterns using year-to-year data from November 14 to January 4. By excluding anomalous periods such as holidays, we establish baseline traffic patterns and identify systematic changes in vehicle density across the monitored region. This ongoing research project will provide regular updates to track long-term evolution of urban mobility patterns in response to the pricing policy.

## Current Limitations

1. The computer vision system includes stationary vehicles in traffic density calculations, which may affect measurements in areas with high street parking density
2. The current implementation analyzes aggregate traffic flow without distinguishing between individual lanes or travel directions
3. Camera-based instantaneous vehicle counts serve as a proxy measure and may not directly correlate with actual transit times or congestion levels

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

## Cite this Project

```bibtex
@misc{mehmet_kerem_turkcan_2025,
  author = {Mehmet Kerem Turkcan},
  title = {nyc-congestionpricing-cv (Revision 9d9dd30)},
  year = 2025,
  url = {https://huggingface.co/datasets/mehmetkeremturkcan/nyc-congestionpricing-cv},
  doi = {10.57967/hf/4448},
  publisher = {Hugging Face}
}

@inproceedings{10.1145/3769102.3770618,
  author = {Ghasemi, Mahshid and Fu, Yongjie and Ouyang, Xinyu and Wang, Peiran and Turkcan, Mehmet Kerem and Tavori, Jhonatan and Kleisarchaki, Sofia and Calmant, Thomas and G\"{u}rgen, Levent and Kostic, Zoran and Di, Xuan Sharon and Zussman, Gil and Ghaderi, Javad},
  title = {Real-Time Video Analytics for Urban Safety: Deployment over Edge and End Devices},
  year = {2025},
  isbn = {9798400722387},
  publisher = {Association for Computing Machinery},
  url = {https://doi.org/10.1145/3769102.3770618},
  doi = {10.1145/3769102.3770618},
  booktitle = {Proceedings of the Tenth ACM/IEEE Symposium on Edge Computing},
  articleno = {14},
  numpages = {17},
  series = {SEC '25}
}
```

## Acknowledgments

This website template was adapted from the [Academic Project Page Template](https://github.com/eliahuhorwitz/Academic-project-page-template), which was based on the [Nerfies](https://nerfies.github.io) project page.
