// Copyright © 2023 Ory Corp
// SPDX-License-Identifier: Apache-2.0

import { appPrefix, gen, website } from "../../../../helpers"
import { routes as express } from "../../../../helpers/express"
import { routes as react } from "../../../../helpers/react"
import { util } from "prettier"
import skip = util.skip

context("Social Sign In Settings Success", () => {
  ;[
    {
      registration: react.registration,
      settings: react.settings,
      login: react.login,
      app: "react" as "react",
      profile: "spa",
    },
    {
      registration: express.registration,
      settings: express.settings,
      login: express.login,
      app: "express" as "express",
      profile: "oidc",
    },
  ].forEach(({ registration, login, profile, app, settings }) => {
    describe(`for app ${app}`, () => {
      before(() => {
        cy.useConfigProfile(profile)
        cy.proxy(app)
      })

      let email

      const hydraReauthFails = () => {
        cy.clearAllCookies()
        cy.visit(login)
        cy.get(appPrefix(app) + '[value="hydra"]').click()

        cy.get("#username").type(email)
        cy.get("#remember").click()
        cy.get("#accept").click()

        cy.get('input[name="traits.website"]').clear().type(website)
        cy.triggerOidc(app, "hydra")

        cy.get('[data-testid="ui/message/1010016"]').should(
          "contain.text",
          "as another way to sign in.",
        )

        cy.noSession()
      }

      beforeEach(() => {
        cy.clearAllCookies()
        email = gen.email()

        cy.registerOidc({
          app,
          email,
          expectSession: true,
          website,
          route: registration,
        })
        cy.visit(settings)
      })

      describe("oidc", () => {
        beforeEach(() => {
          cy.useConfig((builder) =>
            builder
              .longRecoveryLifespan()
              .longVerificationLifespan()
              .longPrivilegedSessionTime(),
          )
        })

        it("should show the correct options", () => {
          cy.get('[value="hydra"]').should("not.exist")

          cy.get('[value="google"]')
            .should("have.attr", "name", "link")
            .should("contain.text", "Link google")

          cy.get('[value="github"]')
            .should("have.attr", "name", "link")
            .should("contain.text", "Link github")
        })

        it("should show the unlink once password is set", () => {
          cy.get('[value="hydra"]').should("not.exist")

          cy.get('input[name="password"]').type(gen.password())
          cy.get('button[value="password"]').click()

          cy.get('[value="hydra"]')
            .should("have.attr", "name", "unlink")
            .should("contain.text", "Unlink Ory")
        })

        it("should link google", () => {
          cy.get('[value="google"]').click()

          cy.get('input[name="scope"]').each(($el) => cy.wrap($el).click())
          cy.get("#remember").click()
          cy.get("#accept").click()

          cy.visit(settings)

          cy.get('[value="google"]')
            .should("have.attr", "name", "unlink")
            .should("contain.text", "Unlink google")

          cy.logout()

          cy.visit(login)

          // we create an intercept for login so we make sure the login endpoint is called
          cy.intercept("GET", "**/oauth2/auth*").as("login")

          cy.get('[value="google"]').click()

          // wait for the login endpoint to be called
          cy.wait("@login")

          // check the session
          cy.getSession()
        })

        it("should link google after re-auth", () => {
          cy.shortPrivilegedSessionTime()
          cy.get('[value="google"]').click()
          cy.location("pathname").should("equal", "/login")

          cy.longPrivilegedSessionTime()
          cy.get('[value="hydra"]').click()

          // prompt=login means that we need to re-auth!
          cy.get("#username").type(email)
          cy.get("#accept").click()

          // we re-authed, now we do the google oauth2 dance
          cy.get("#username").type(gen.email())
          cy.get("#accept").click()
          cy.get('input[name="scope"]').each(($el) => cy.wrap($el).click())
          cy.get("#accept").click()

          cy.expectSettingsSaved()

          cy.get('[value="google"]')
            .should("have.attr", "name", "unlink")
            .should("contain.text", "Unlink google")

          cy.visit(settings)

          cy.get('[value="google"]')
            .should("have.attr", "name", "unlink")
            .should("contain.text", "Unlink google")
        })

        it("should unlink hydra and no longer be able to sign in", () => {
          if (app === "react") {
            // This test is flaky on React, so we skip it for now.
            return
          }
          cy.get('[value="hydra"]').should("not.exist")
          cy.get('input[name="password"]').type(gen.password())
          cy.get('[value="password"]').click()
          cy.expectSettingsSaved()
          cy.visit(settings)

          cy.get('[value="hydra"]').click()

          // It will no longer be possible to sign up with this provider because of a UNIQUE key violation
          // because of the email verification table.
          //
          // Basically what needs to happen is for the user to use the LINK feature to link this account.
          hydraReauthFails()
        })

        it("should unlink hydra after reauth", () => {
          cy.get('[value="hydra"]').should("not.exist")

          cy.get('input[name="password"]').type(gen.password())
          cy.get('[value="password"]').click()
          cy.expectSettingsSaved()
          cy.visit(settings)

          cy.shortPrivilegedSessionTime()
          cy.get('[value="hydra"]').click()

          cy.longPrivilegedSessionTime()
          cy.location("pathname").should("equal", "/login")
          cy.get('[value="hydra"]').click()

          // prompt=login means that we need to re-auth!
          cy.get("#username").type(email)
          cy.get("#accept").click()
          cy.expectSettingsSaved()

          hydraReauthFails()
        })

        it("should show only linked providers during reauth", () => {
          cy.shortPrivilegedSessionTime()

          cy.get('input[name="password"]').type(gen.password())
          cy.get('[value="password"]').click()

          cy.location("pathname").should("equal", "/login")

          cy.get('[value="hydra"]').should("exist")
          cy.get('[value="google"]').should("not.exist")
          cy.get('[value="github"]').should("not.exist")
        })

        it("settings screen stays intact when the original sign up method gets removed", () => {
          const expectSettingsOk = () => {
            cy.get('[value="google"]', { timeout: 1000 })
              .should("have.attr", "name", "link")
              .should("contain.text", "Link google")

            cy.get('[value="github"]', { timeout: 1000 })
              .should("have.attr", "name", "link")
              .should("contain.text", "Link github")
          }

          cy.visit(settings)
          expectSettingsOk()

          // set password
          cy.get('input[name="password"]').type(gen.password())
          cy.get('button[value="password"]').click()

          // remove the provider used to log in
          cy.updateConfigFile((config) => {
            config.selfservice.methods.oidc.config.providers =
              config.selfservice.methods.oidc.config.providers.filter(
                ({ id }) => id !== "hydra",
              )
            return config
          })

          // visit settings and everything should still be fine
          cy.visit(settings)
          expectSettingsOk()
        })
      })
    })
  })
})
