context("GET /resorts", () => {
  it("gets a list of resorts", () => {
    //Make a GET request to the /resorts endpoint
    cy.request("GET", "http://localhost:3000/resorts").then((response) => {
      //Check that the response status is 200
      expect(response.status).to.eq(200)

      //Check that the response body is an array
      expect(response.body).to.be.an("array")

      //Check that the first element of the array is an object with the expected properties
      expect(response.body[0]).to.have.property("name")
      expect(response.body[0]).to.have.property("location")
      expect(response.body[0]).to.have.property("elevation")
    })
  })
})

context("POST & DELETE /resorts", () => {
  it("creates and deletes a resort", () => {
    const newResort = {
      name: "Test Resort",
      location: "Test Location",
      elevation: 1000,
    }

    //Make a POST request to create a new resort
    cy.request("POST", "http://localhost:3000/resorts", newResort).then((response) => {
      //Check that the response status is 201 (Created)
      expect(response.status).to.eq(201)
      //Check that the response body contains the created resort data
      expect(response.body).to.have.property("_id")
      expect(response.body.name).to.eq(newResort.name)
      expect(response.body.location).to.eq(newResort.location)
      expect(response.body.elevation).to.eq(newResort.elevation)

      //Make a DELETE request to delete the created resort
      cy.request("DELETE", `http://localhost:3000/resorts/${newResort.name}`).then((deleteResponse) => {
        expect(deleteResponse.status).to.eq(200)
        expect(deleteResponse.body).to.have.property("message")
        expect(deleteResponse.body.message).to.eq("Resort deleted successfully")
      })
    })
  })
})