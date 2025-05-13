context("GET /resorts", () => {
  it("gets a list of resorts", () => {
    //Make a GET request to the /resorts endpoint
    cy.request("GET", "http://localhost:3000/resorts").then((response) => {
      //Check that the response status is 200
      expect(response.status).to.eq(200)

      //Check that the response body is an array
      expect(response.body).to.be.an("array")
    })
  })
})

context("GET /resorts/names and resorts/:name", () => {
  it("gets a list of resort names", () => {
    //Make a GET request to the /resorts/names endpoint
    cy.request("GET", "http://localhost:3000/resorts/names").then((response) => {
      //Check that the response status is 200
      expect(response.status).to.eq(200)

      //Check that the response body is an array
      expect(response.body).to.be.an("array")

      //Check that the first element of the array is a string
      expect(response.body[0]).to.be.a("string")
      cy.request("GET", `http://localhost:3000/resorts/${response.body[0]}`).then((resortResponse) => {
        //Check that the response status is 200
        expect(resortResponse.status).to.eq(200)
      })

    })
  })
})

context("POST & DELETE /resorts", () => {
  it("creates and deletes a resort", () => {
    const newResort = {
      "name":"e2e",
      "slopes": [
          {
              "name":"test slope",
              "elevation":1234,
              "difficulty":"Green",
              "listCoordinates":[
                  {
                      "lat":1234.022,
                      "lng":1234.033
                  },
                  {
                      "lat":1234.6514,
                      "lng":1234.456
                  }
              ],
              "intersections":[
                  {
                      "name":"oui",
                      "coordinates":[
                          {
                              "lat":1234.36,
                              "lng":1234.366
                          }
                      ]
                  }
              ]
                  }
              ],
      "lifts":[
          {
              "name":"testest",
              "start":{
                  "lat":1234.6455,
                  "lng":23434.65496
              },
              "end":{
                  "lat":1234.45,
                  "lng":1234.65496
              }
          }
      ]
  }

    //Make a POST request to create a new resort
    cy.request("POST", "http://localhost:3000/resorts", newResort).then((response) => {

      //Make a DELETE request to delete the created resort
      cy.request("DELETE", `http://localhost:3000/resorts/${newResort.name}`).then((deleteResponse) => {
        expect(deleteResponse.status).to.eq(200)
        expect(deleteResponse.body).to.have.property("message")
        expect(deleteResponse.body.message).to.eq("Resort deleted successfully")
      })
    })
  })
})