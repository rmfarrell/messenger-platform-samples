const convert = require('color-convert')
const Canvas = require('canvas')
const Image = Canvas.Image
const fs = require('fs')
const request = require('request')
const fetch = require('node-fetch')
const uuidv4 = require('uuid/v4')

const tmpDir = __dirname + '/public'

module.exports = class SkinToneFinder {

  constructor(options={subscriptionKey:'', src:''}) {
    this.subkey = options.subscriptionKey
    this.ctx = null
    this.canvas = null
    this.src = options.src
    this.faceApiData = {}
  }

  findAverageColorSample() {
    return this._createTmp()
      .then(() => this._downloadImage(this.src))
      .then((ws) => this._loadImageToCanvas(ws.path))
      .then(() => this._fetchFaceData(this.src))
      .then((dat) => {
        this.faceApiData = dat[0]
        return this._samplePoints()
      })
      .catch(err => {
        throw err
      })
  }

  /**
   * Sample all new facelandmarks
   * @return {Array.Number} return hsl value
   */
  _samplePoints() {
    const colorSamples = [
      this._samplePixel(this.findForehead()),
      this._samplePixel(this.findRightCheek()),
      this._samplePixel(this.findLeftCheek())
    ]
    return this._averageHSL(colorSamples)
  }

  /**
   * Make a POST request to MS face detect API
   * Takes a string, but can be rewritten to take an octect-stream as well.
   * @param {string} url URL to public image
   * @return {Promise}
   * @fufills {Object}
   * @rejects {Error}
   */
  _fetchFaceData(url) {
    const uriBase = 'https://westcentralus.api.cognitive.microsoft.com/face/v1.0/detect'
    const params = '?returnFaceId=true' +
      '&returnFaceLandmarks=true'
    const requestUrl = uriBase + params
    const myHeaders = new fetch.Headers({
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': this.subkey
    })
    var myRequest = new fetch.Request(requestUrl, {
      method: 'POST',
      mode: 'cors',
      headers: myHeaders,
      body: JSON.stringify({url: url})
    })
    return fetch(myRequest)
      .then((res) => {
        return res.json()
      })
      .catch((err) => err)
  }

  /**
  * Find the forehead in a photo given an MS API response
  * @param {CanvasRenderingContext2D} ctx
  * @return {x: Number, y: Number}
  */
  findForehead() {
    let fd = this.faceApiData
    let r  = fd.faceLandmarks.eyebrowLeftInner
    let l = fd.faceLandmarks.eyebrowRightInner
    return {
      x: (l.x  + r.x) / 2,
      y: (l.y  + r.y) / 2 - this._faceHeightPercent(12, fd)
    }
  }

  /**
  * Find the right cheek in a photo given an MS Face API response
  * @return {x: Number, y: Number}
  */
  findRightCheek() {
    return this._findCheek(this.faceApiData.faceLandmarks['eyeRightBottom'])
  }

  /**
  * Find the left cheek in a photo given an MS Face API response
  * @return {x: Number, y: Number}
  */
  findLeftCheek() {
    return this._findCheek(this.faceApiData.faceLandmarks['eyeLeftBottom'])
  }

  /**
  * Get the offset of a landmark 15%
  * @param {Object} lm coordinates of canvas context 2d
  * @param {Number} lm.x
  * @param {Number} lm.y
  * @return {x: Number, y: Number}
  */
  _findCheek(lm={x:0, y:0}) {
    return {
      x: lm.x,
      y: lm.y + this._faceHeightPercent(15)
    }
  }

  _loadImageToCanvas(path='') {
    return new Promise((resolve, reject) => {
      fs.readFile(path, (err, src) => {
        if (err) reject(err)
        let img = new Image
        img.src = src
        this.canvas = this._createCanvas(img)
        this.ctx = this.canvas.getContext('2d')
        this._placeImage(this.ctx, img)
        resolve()
      })
    })
  }

  /**
  * Express distance on a face as a percentage of overall face height
  * @param {Number} pct the percent of face height to return
  * @return {Number} number of pixles a percent of face height represents
  */
  _faceHeightPercent(pct=0) {
    return (this.faceApiData.faceRectangle.height / 100) * pct
  }

  /**
   * Average an array of HSL (hue/saturation/light) values
   * @param {Array.Array.String} hsls an array of HSL values
   * @return {Array.String} an hsl value
   */
  _averageHSL(hsls = [][0,0,0]) {
    let avgHue = 0
    let avgSat = 0
    let avgLit = 0
    let c = 0
    for (let h of hsls) {
      avgHue += h[0]
      avgSat += h[1]
      avgLit += h[2]
      c++
    }
    avgHue = avgHue/c
    avgSat = avgSat/c
    avgLit = avgLit/c
    return [avgHue, avgSat, avgLit]
  }

  /**
   * Convert an RGB value to an HSL value
   * @param {Array.Number}
   * @return {Array.Number}
   */
  _convertImageDataToHsl(dat=[0,0,0]) {
    return convert.rgb.hsl(dat[0], dat[1], dat[2])
  }


  /**
  * Sample the color of the x/y coordinates on a canvas
  * @param {Object} coords
  * @param {Number} coords.x
  * @param {Number} coords.y
  * @reuturn {Array.Number} 3 digits representing an HSL value
  */
  _samplePixel(coords={x:0, y:0}) {
    const id = this.ctx.getImageData(coords.x, coords.y, 1, 1).data
    return this._convertImageDataToHsl(id)
  }

  /**
   * Create a canvas w/ image height and width
   * @return {Canvas}
   */
  _createCanvas(img) {
    return new Canvas(img.width, img.height)
  }

  /**
   * Place an image on the canvas as 0 position
   * @param {CanvasRenderingContext2D}
   */
  _placeImage(ctx, img) {
    ctx.drawImage(img, 0, 0, img.width, img.height)
  }

  _createTmp() {
    return new Promise((resolve) => {
      fs.exists(tmpDir, (isExists) => {
        if (!isExists) {
          fs.mkdir(tmpDir, () => {
            resolve()
          })
        }
        resolve()
      })
    })
  }

  _downloadImage(url='') {
    const fileName = uuidv4()
    const ws = fs.createWriteStream(`${tmpDir}/${uuidv4()}`)
    return new Promise((resolve, reject) => {
      request.get(url)
      .on('error', function(err) {
        reject(err)
      })
      .on('end', () => {
        resolve(ws)
      })
      .pipe(ws)
    })
  }
}
