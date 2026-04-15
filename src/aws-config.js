const awsConfig = {
  Auth: {
    Cognito: {
      userPoolId: "us-east-1_m79WV8kDc",
      userPoolClientId: "6u7bnus1elrgt0fem6kfb64mk",
      loginWith: {
        email: true
      }
    }
  },
  API: {
    GraphQL: {
      endpoint: "https://aok6tupiqbfv5e4x7hajjcnny4.appsync-api.us-east-1.amazonaws.com/graphql",
      region: "us-east-1",
      defaultAuthMode: "amazonCognitoUserPools"
    }
  }
};

export default awsConfig;