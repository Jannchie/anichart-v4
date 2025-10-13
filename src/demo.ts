/* eslint-disable unicorn/prefer-top-level-await */
import { Application } from 'pixi.js'
import { BarChart } from './BarChart'
import { Config } from './Config'
import { DataProcessor } from './DataProcessor'

;

(async () => {
  const app = new Application()
  const config = new Config()

  try {
    const data = await DataProcessor.processCSV('/base.csv', config)
    await app.init({
      width: config.canvasWidth,
      height: config.canvasHeight,
      backgroundColor: config.backgroundColor,
      hello: true,
    })

    const barChart = new BarChart(data, config)
    app.stage.addChild(barChart)
    document.body.append(app.canvas)
    let frame = 0
    function animate() {
      barChart.update(frame % data.length)
      frame++
      requestAnimationFrame(animate)
    }
    animate()
  }
  catch (error) {
    console.error('Failed to load demo:', error)
  }
})()
